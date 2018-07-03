
const path = require('path');
const loader = require('./loader');
const helpers = require('./helper');
const BarcemideHook = require('./hook');

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
    // Load the main models using the Barmecide loader, so we won't wind up with partial definitions within
    // hooks destroying the main definitions.
    loader.loadModels(sails, sails.config.paths.models);

    // Finally, bind the barmecide object to the sails object.
    sails.barmecide = barmecide;
    sails.log.debug('[Barmecide]', 'Finished initializing! Hooks will now be loaded...');

    // Start initializing the dependency hooks which Sails won't load by itself.
    dependencyHooks.forEach(hook => {
        const Shrek = __hooks(sails);
        const createHook = require(hook.mainFilePath);
        const hookInstance = createHook(sails);

        sails.hooks[hook.name] = new Shrek(hookInstance);
        sails.hooks[hook.name].identity = hook.name;
        sails.hooks[hook.name].configKey = hook.name;
    });
}
