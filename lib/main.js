
const path = require('path');
const loader = require('./loader');
const helpers = require('./helper');
const BarcemideHook = require('./hook');
const includeAll = require('include-all');

const __hooks = require('sails/lib/hooks');

module.exports = {

    /**
    * The hook base-class which any Barcemide hook must extend.
     */
    Hook: BarcemideHook,

    /**
     * @param {Class} Hook - The hook class which should be instantiated.
     */
    createSailsHook(Hook) {
        // If the hook isn't a proper BarmecideHook, leave with an error immediately.
        // (In the past `!(Hook.prototype instanceof BarcemideHook)` was used, now we just check for Barmecide-ness)
        if (!(Hook instanceof Function) || !(Hook.prototype.toNaturalHook instanceof Function)) {
            throw new Error(`Expected "Hook" to be a valid BarmecideHook, but instead found: (${typeof Hook}) ${JSON.stringify(Hook)}`);
        }

        const hookFunc = sails => {
            initBarmecide(sails);

            /**
             * Attempt to construct the appropriate barmecide hook class.
             * @type {BarcemideHook}
             */
            const hookInst = new Hook(sails);

            // Return the resulting natural Sails hook generated.
            return hookInst.toNaturalHook();
        };
        // Tag our hook wrapper function, so we can distinguish barmecide dependencies.
        hookFunc.isBarmecideHook = true;

        return hookFunc;
    },

};

function initBarmecide(sails) {
    // If we've already initialized the barmecide environment, just leave.
    if (('barmecide' in sails) && (sails['barmecide'] instanceof Object)) {
        return;
    }

    sails.log.debug('[Barmecide]', 'Beginning initialization...');

    // Otherwise, we've some setup to do!
    const barmecide = {
        hooksListing: [],
        activeHooks: [],
        modelDirectories: [],
        modelModules: [],
        rootPath: path.resolve(sails.config.paths.tmp, '..'),
        hookPath: sails.config.paths.hooks,
        findHook(identity) {
            return this.hooksListing.find(hook => hook.name === identity);
        },
        finishedLoading() {
            return this.hooksListing.every(hook => hook.hasLoaded === true);
        }
    };

    const rootPackagePath = path.resolve(barmecide.rootPath, 'package.json');
    const rootPackage = require(rootPackagePath);
    // Find all main hooks living in the plain dependencies (node modules).
    const mainDepHooks = helpers.findHookDependencies(rootPackage, helpers.makeModuleSearchPaths(rootPackagePath)).map(hook => {
        hook.isMainHook = true;
        hook.isDependencyHook = false;
        return hook;
    });
    // Find all main hooks living in the api/hooks/ path.
    const mainApiHooks = helpers.findApiPathHooks(sails.config.paths.hooks).map(hook => {
        hook.isMainHook = true;
        hook.isDependencyHook = false;
        return hook;
    });
    // Merge together the main and API-path hooks, ensuring only unique values exist.
    const mainHooks = [...mainDepHooks, ...mainApiHooks].reduce((acc, v) => {
        // If we've no such hook already, push it.
        if (!acc.find(h => h.name === v.name || h.packageName === v.packageName)) {
            acc.push(v);
        }
        return acc;
    }, []);
    // Find our dependency hooks, that is, those required and installed by the main hooks and their dependencies.
    const dependencyHooks = helpers.findHookChildDependencies(mainHooks).map(hook => {
        hook.isMainHook = false;
        hook.isDependencyHook = true;
        return hook;
    });

    // Setup our full hook listing.
    barmecide.hooksListing = [...mainHooks, ...dependencyHooks];

    // Reset the custom model definition space.
    sails.config.orm = (sails.config.orm instanceof Object) ? sails.config.orm : {};
    sails.config.orm.moduleDefinitions = {
        models: {},
    };

    // Finally, bind the barmecide object to the sails object.
    sails.barmecide = barmecide;
    sails.log.debug('[Barmecide]', 'Finished initializing! Hooks will now be loaded...');

    // Load the main models using the Barmecide loader, so we won't wind up with partial definitions within
    // hooks destroying the main definitions.
    loader.loadModels(sails, sails.config.paths.models);

    // Start initializing the dependency hooks which Sails won't load by itself.
    dependencyHooks.forEach(hook => {
        const Shrek = __hooks(sails);
        const createHook = require(hook.mainFilePath);
        const hookInstance = createHook(sails);

        sails.hooks[hook.name] = new Shrek(hookInstance);
        sails.hooks[hook.name].identity = hook.name;
        sails.hooks[hook.name].configKey = hook.name;
    });

    // Add an event handler for the ORM hook loading, so we can handle certain setup operations.
    sails.on('hook:orm:loaded', () => {
        // For each loaded model MODULE, we have to go through and patch them with the merged module,
        // JUST IN CASE some weird code uses module.exports to access attribute definitions.
        //
        // Why so? Because unfortunately Sails modifies the module definitions, instead of generating
        // a new object and leaving it alone. This causes attributes isIn, etc, to be removed, while
        // processed values are placed under a `validations` object.
        //
        // Without this patching here, certain module.exports would have the validations replaced, while
        // others might not, causing issues if the code just so happens to rely on this behaviour.
        //
        // Annoyingly, we have to rely on using model directories and a full new includeAll, in addition
        // to simply storing a list of loaded model modules, as the module cache is invalidated.
        //
        barmecide.modelDirectories.forEach(path => {
            const models = includeAll({
                dirname: path,
                filter: /^(.+)\.(?:(?!md|txt).)+$/,
                replaceExpr: /^.*\//,
                flatten: true,
                optional: true,
            });

            Object.keys(models).forEach(modelName => {
                // Try and find the merged and loaded module definition.
                const mergedModule = sails.config.orm.moduleDefinitions.models[modelName.toLowerCase()];
                // If we haven't found it, that's pretty freaky but we'll allow it, just skip.
                if (!mergedModule) {
                    return;
                }
                // Pretty much replace the original module with the merged one.
                Object.assign(models[modelName], mergedModule);
            });
        });
        // We'll replace also the original modules just to be extra safe...
        barmecide.modelModules.forEach(model => {
            // Try and find the merged and loaded module definition.
            const mergedModule = sails.config.orm.moduleDefinitions.models[model.identity];
            // If we haven't found it, that's pretty freaky but we'll allow it, just skip.
            if (!mergedModule) {
                return;
            }
            // Replace the original module with the merged one.
            Object.assign(model.module, mergedModule);
        });
    });
}
