
const fs = require('fs');
const path = require('path');

module.exports = {

    /**
     * Attempts to find the path of the given module's package.json file, returning a string
     * file-path if successful, or undefined otherwise.
     *
     * @param {NodeModule|string} targetModule - The module for which the search for a valid
     * package.json will be performed. This may be either a proper NodeModule object, or the
     * path of a supposed package's main script.
     *
     * @returns {string|undefined} The path for the appropriate package.json, or undefined
     * if no proper package.json could be found.
     */
    findModulePackage(targetModule) {
        // Note: given a proper NodeModule, finding the package.json is simply a matter of
        // resolving '../package.json' from `paths[0]`. However, we'll not use this trick
        // and use instead a generic method of finding it, as we must support both plain
        // strings as well.

        /**
         * Helper function which recursively searches for the first package.json file going
         * upwards from the given directory. This is not necessarily the file corresponding
         * to the executing module, but simply the nearest package.json going straight up.
         *
         * @param {string} directory - The directory to begin the package.json search in.
         *
         * @returns {string|undefined} Returns a string if a package.json could be found,
         * otherwise returns undefined.
         */
        function packageSearch(directory) {
            // Generate a path for what a package.json would look like in the current directory.
            const pkgJson = path.resolve(directory, 'package.json');

            // If the package.json file exists, return the path immediately.
            // I feel bad about using synchronous code here, but there are honestly very
            // few of these operations in a typical case, and we'll likely have to run a
            // synchronous require anyway.
            if (fs.existsSync(pkgJson)) {
                return pkgJson;
            }

            // Get the next directory up, for continuing our search!
            const upDirectory = path.resolve(directory, '..');
            // If the up-directory matches the current, we've reached the top–wups! (This means
            // we've simply a module running without a package.json and can't do much about it).
            if (upDirectory === directory) {
                return undefined;
            }

            // Otherwise, let's try just checking for a package.json in the next directory up.
            return packageSearch(upDirectory);
        }

        // Extract the path of our main .js file, either from the target module's filename
        // property, or taking the parameter directly as a path.
        const mainFilePath = (targetModule instanceof Object) ? targetModule.filename : targetModule;

        // Try and find our package.json path.
        const packageJsonPath = packageSearch(mainFilePath);
        // If we've not found any path, simply return undefined early.
        if (!packageJsonPath) {
            return undefined;
        }

        // Otherwise, we've got our path, though we'll run one more step before returning.
        // It's time to verify that the found package.json actually matches the given module.
        const pkg = require(packageJsonPath);
        // Leave early in the case of funky package.json data.
        if (!(pkg instanceof Object) || (typeof pkg.main !== 'string')) {
            return undefined;
        }

        // Calculate the main file path per the package.json.
        const calculatedMainPath = path.resolve(path.dirname(packageJsonPath), pkg.main);
        // If our calculated path matches the original main file path we'd set, then this
        // package.json is all good, return it!
        if (calculatedMainPath === mainFilePath) {
            return packageJsonPath;
        }

        // Otherwise, there's no finding the proper package, so return undefined.
        return undefined;
    },

    /**
     * @todo See about adapting the code to use something like this.
     *
     * @returns {string|undefined} Returns a path to the parent hook/project which initiated
     * the loading process for the given hook module.
     */
    findModuleParentPackage(_targetModule) {
        throw new Error('Not yet implemented!');
    },

    /**
     * Finds all Barmecide hooks depended on by the given package, within the provided search
     * paths.
     *
     * @param {Object} nodePackage - Node package descriptor object (i.e. a loaded package.json).
     * @param {string|string[]} searchPaths - The paths (or path) that should be searched for the
     * dependencies listed within the given `package`.
     *
     * @returns {Object[]} An array of objects describing the found hook dependencies.
     */
    findHookDependencies(nodePackage, searchPaths) {
        // If we've been given a non-node package, simply return an empty array.
        if (!(nodePackage instanceof Object)) {
            return [];
        }

        // Merge all the main and dev dependencies into one object.
        // Where a dependencies object doesn't exist, it will be replaced by an empty object.
        const packageDeps = Object.assign(
            {},
            (nodePackage.dependencies instanceof Object) ? nodePackage.dependencies : {},
            (nodePackage.devDependencies instanceof Object) ? nodePackage.devDependencies : {},
        );

        // Ensure our search paths is an array: wrapping it up if not.
        searchPaths = Array.isArray(searchPaths) ? searchPaths : [searchPaths];

        function findPackageInPaths(packageName, paths) {
            for (let i = 0; i < paths.length; i++) {
                const searchBase = paths[i];
                const potentialPath = path.resolve(searchBase, `./${packageName}/`);
                if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isDirectory) {
                    const packagePath = path.resolve(potentialPath, './package.json');
                    if (fs.existsSync(packagePath) && fs.statSync(packagePath).isFile) {
                        return packagePath;
                    }
                }
            }
            return undefined;
        }

        // Setup our output hook dependencies list.
        const hookDependencies = [];
        Object.keys(packageDeps).forEach(depName => {
            // Try and find the package.json path for the given dependency.
            const pkgPath = findPackageInPaths(depName, searchPaths);

            // Leave if there exists no package.json for the hook.
            if (typeof pkgPath !== 'string') {
                return;
            }

            // Load the package file, so we can start checking whether or not it's a Sails/Barmecide hook.
            const pkg = require(pkgPath);

            // If it's not declared as a Sails hook, just leave, as there's no way it's a proper Barmecide hook.
            if (!(pkg instanceof Object) || !(pkg.sails instanceof Object) || (pkg.sails.isHook !== true)) {
                return;
            }

            // Determine the path of our potential hook's main file.
            const pkgMainPath = path.resolve(pkgPath, '..', pkg.main || 'index.js');

            // Leave if tha main package file doesn't exist.
            if (!fs.existsSync(pkgMainPath) || !fs.statSync(pkgMainPath).isFile) {
                return;
            }

            // Try and import our main package file.
            const pkgMain = require(pkgMainPath);

            // Leave if the hook isn't a proper function definition or BarmecideHook.
            if (!(pkgMain instanceof Function) || (pkgMain.isBarmecideHook !== true)) {
                return;
            }

            // Select the hook name from either the package, or default to the dependency otherwise.
            const hookName = ((typeof pkg.sails.hookName === 'string') ? pkg.sails.hookName : depName).toLowerCase();

            // Skip if we already have such a hook in the dependencies list.
            if (hookDependencies.find(v => v.name === hookName)) {
                return;
            }

            // Otherwise, generate an appropriate hook definition and add it to our list.
            return hookDependencies.push({
                name: hookName,
                packageName: depName,
                packageFilePath: pkgPath,
                mainFilePath: pkgMainPath,
                version: pkg.version,
            });
        });

        return hookDependencies;
    },

    /**
     * Find all hooks existing under the given path, for which a package.json exists.
     */
    findApiPathHooks(apiHooksPath) {
        // If the hooks path isn't a real folder, leave with an empty list.
        if (!fs.existsSync(apiHooksPath) || !fs.statSync(apiHooksPath).isDirectory) {
            return [];
        }

        // Find the names of all hook folders:
        const hookNames = fs.readdirSync(apiHooksPath).filter(entryName => {
            const fullPath = path.resolve(apiHooksPath, entryName);
            return fs.statSync(fullPath).isDirectory;
        });

        const dependencies = hookNames.reduce((acc, name) => {
            acc[name] = name;
            return acc;
        }, {});

        const apiHooks = this.findHookDependencies({ dependencies }, apiHooksPath).map(hook => {
            // API hooks get special treatment as far as their name goes, so handle this.
            hook.name = path.basename(path.resolve(hook.packageFilePath, '..'));
            return hook;
        });

        return apiHooks;
    },

    /**
     * Finds a list of all unique child dependencies which belong to the given hooks (or list of hooks).
     *
     * @param {Object|Object[]} hooks - The hook or hooks which should have dependencies searched.
     * @param {Object[]} exclude - A list of hooks which should be excluded from loading. This is used to
     * prevent infinite recursion (rather, stack overflow) occurring for hooks where one or more circular
     * dependencies exist. Generally, this is all loaded dependencies (child + main).
     *
     * @returns {Object[]} An array of objects describing the found hook dependencies.
     */
    findHookChildDependencies(hooks, exclude) {
        // Ensure hooks is an array, wrapping any given value if not.
        hooks = Array.isArray(hooks) ? hooks : [hooks];

        // Setup our output dependency list.
        const childDependencies = [];
        hooks.forEach(hook => {
            const hookPackage = require(hook.packageFilePath);
            const hookChildren = this.findHookDependencies(hookPackage, this.makeModuleSearchPaths(hook.packageFilePath)).filter(dep => {
                // If a dependency with this hook or package name has already been loaded into our childDependencies, exclude this one.
                if (childDependencies.find(d => d.name === dep.name || d.packageName === dep.packageName)) {
                    return false;
                }
                // If a dependency with this hook or package name has already been loaded into the main hooks, exclude this one.
                if (hooks.find(d => d.name === dep.name || d.packageName === dep.packageName)) {
                    return false;
                }
                // If it's in the exclusion list, ignore it as well (not a fan of this method..).
                if (Array.isArray(exclude) && exclude.find(d => d.name === dep.name || d.packageName === dep.packageName)) {
                    return false;
                }
                // Otherwise, the hook is an all-good, unique one, so include it.
                return true;
            });

            // Add the new child hooks to our list.
            childDependencies.push(...hookChildren);
        });

        // Aaaand recurse..
        if (childDependencies.length > 0) {
            exclude = Array.isArray(exclude) ? exclude.concat(childDependencies) : hooks;
            childDependencies.push(...this.findHookChildDependencies(childDependencies, exclude));
        }

        return childDependencies;
    },

    makeModuleSearchPaths(packageFilePath) {
        const paths = [];

        let prevSearchPath = packageFilePath;
        let searchPath = path.resolve(prevSearchPath, '../node_modules/');

        while (searchPath !== prevSearchPath) {
            paths.push(searchPath);
            prevSearchPath = searchPath;
            searchPath = path.resolve(prevSearchPath, '../../node_modules/');
        }

        return paths;
    },

};
