
const vanity = require('./vanity');
const loader = require('./loader');
const path = require('path');
const _ = require('lodash');

module.exports = class BarmecideHook {

    constructor(sails, hookModule) {
        this.sails = sails;
        this.class = this.constructor.name;
        this.module = hookModule;
        this.path = path.dirname(hookModule.filename);
        this.globalEntry = undefined;
        this.status = 'Loading';

        // Setup some basic prefs object.
        this.prefs = {
            merge: {
                controllers: true,
                models: true,
                services: true,
                policies: true,
                config: true,
            },
        };

        // Setup the hook resources object.
        this.items = {
            controllers: {},
            models: {},
            services: {},
            policies: {},
            config: {},
        };

        // Add this hook instance to the global listing.
        sails.barmecide.activeHooks.push(this);
    }

    /**
     * Just a default implementation of the initialize method.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/initialize
     */
    initialize(done) {
        return done();
    }

    /**
     * Just a default implementation of the registerActions method.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/register-actions
     */
    registerActions(done) {
        return done();
    }

    /**
     * Just a default implementation of the configure method.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/configure
     */
    configure() {

    }

    /**
     * Just a default implementation of the defaults method.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/defaults
     */
    defaults(_overrides) {
        return {
            [this.configKey]: {}
        };
    }

    /**
     * Just a default implementation of the routes method.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/routes
     */
    routes() {
        return {
            before: {
                // Put here any route handlers which should run BEFORE user-defined routes.
            },
            after: {
                // Put here any route handlers which should run AFTER user-defined routes.
            }
        };
    }

    /**
     * @returns {Object} An appropriate, natural Sails hook built against the Barmecide hook.
     */
    toNaturalHook() {
        // Pull out the underlinyg Barmecide hook.
        const hook = this;
        const sails = this.sails;

        // Return our Sails hook object, with wrappers around the underlying hook functions.
        return {

            initialize(done) {
                // Run the underlying initialize method...
                hook.initialize(err => {
                    // If an error was encountered, leave straight away.
                    if (err) {
                        return done(err);
                    }

                    // Otherwise, continue to register actions.
                    return this.registerActions(regErr => {
                        // If the action registration has failed, leave straight away with the error.
                        if (regErr) {
                            return done(regErr);
                        }
                        // Otherwise, we're completely done loading this hook, mark it as loaded!
                        hook.globalEntry.hasLoaded = true;
                        hook.status = 'OK';
                        // Just in the event this was the last hook and we've now finished, output some summary info:
                        // TODO: move this to barmecide main
                        if (sails.barmecide.finishedLoading()) {
                            sails.log.info('[Barmecide]', 'All hooks finished loading!');
                            sails.log.info('[Barmecide]', 'Loaded hooks summary:\n' + vanity.renderLoadInformation(sails.barmecide.activeHooks));
                        }
                        // Emit an event which can be listened for, signalling that the hook has been completely loaded.
                        sails.emit(`barmecide:hooks:${hook.globalEntry.name}:loaded`);
                        return done();
                    });
                });
            },

            registerActions(done) {
                // Attempt to run the hook-provided `registerActions` method...
                hook.registerActions(err => {
                    // If an error was encountered, leave straight away.
                    if (err) {
                        return done(err);
                    }
                    // Otherwise, the user's custom actions have been registered successfully.
                    // We'll now merge controllers, if desired.
                    if (hook.prefs.merge.controllers) {
                        hook.items.controllers = loader.loadControllers(sails, path.resolve(hook.path, './api/controllers/'));
                    }
                    return done();
                });
            },

            configure() {
                // Run the underlying configure method.
                hook.configure();

                // Update the internal merge preferences.
                const barmecideConfig = (sails.config[this.configKey] instanceof Object) && (sails.config[this.configKey].barmecide instanceof Object)
                    ? sails.config[this.configKey].barmecide
                    : {};
                ['controllers', 'services', 'policies', 'models', 'config'].forEach(key => {
                    hook.prefs.merge[key] = (barmecideConfig[key] !== false);
                });

                // Merge models, if desired.
                if (hook.prefs.merge.models) {
                    hook.items.models = loader.loadModels(sails, path.resolve(hook.path, './api/models/'));
                }
                // Merge services, if desired.
                if (hook.prefs.merge.services) {
                    hook.items.services = loader.loadServices(sails, path.resolve(hook.path, './api/services/'));
                }
                // Merge policies, if desired.
                if (hook.prefs.merge.policies) {
                    hook.items.policies = loader.loadPolicies(sails, path.resolve(hook.path, './api/policies/'));
                }

            },

            /**
             * This is the first method (that we handle) called when setting up a hook. This method
             * should be used to perform any setup which cannot be done in just the constructor.
             */
            defaults(overrides) {
                // Patch the underlying hook, with our identity and configKey from the crafted, loading hook.
                hook.identity = this.identity;
                hook.configKey = this.configKey;
                hook.sailsHook = this;
                hook.globalEntry = sails.barmecide.findHook(this.identity);

                // Add the hook instance to our global entry, if defined.
                if (hook.globalEntry) {
                    hook.globalEntry.instance = hook;
                } else {
                    throw new Error(`Failed to find hook with identity "${this.identity}". Please ensure you've all node packages installed properly.`);
                }

                // Call our underlying defaults function, retrieving defaults, or using a basic object if none were found.
                let defaults = hook.defaults(overrides);
                defaults = (defaults instanceof Object) ? defaults : {};

                // Import all our configuration files so we can check our hook info.
                const config = loader.loadConfig(path.resolve(hook.path, './config/'));

                // Generate a basic merged configuration, so we can check if should actually merge our configuration (or anything, for that matter).
                const mergedConfig = _.defaultsDeep({}, sails.config, defaults, config);
                // Extract the hook's appropriate barmecide config, or default to a plain object if there's no appropriate object set.
                const barmecideConfig = (mergedConfig[this.configKey] instanceof Object) && (mergedConfig[this.configKey].barmecide instanceof Object)
                    ? mergedConfig[this.configKey].barmecide
                    : {};

                // Determine whether or not everything should be merged in for later on.
                // Right now this is pretty lax, with any non-false value resulting in a merge.
                // A warning could be issued if any non-boolean value is given...
                ['controllers', 'services', 'policies', 'models', 'config'].forEach(key => {
                    hook.prefs.merge[key] = (barmecideConfig[key] !== false);
                });

                // Merge our configuration in, if desired.
                if (hook.prefs.merge.config) {
                    _.defaultsDeep(sails.config, config);
                    hook.items.config = config;
                }

                // Return the retrieved defaults.
                return defaults;
            },

            routes() {
                // Call the underlying routes function to retrieve any hook-defined routes.
                const routes = hook.routes();

                // Return the retrieved routes value if it's a proper object, otherwise a plain empty object.
                return (routes instanceof Object) ? routes : {};
            },

        };
    }

};
