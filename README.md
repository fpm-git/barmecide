# barmecide

A castle of fog; a mirage; "superpowers for your Sails.js hooks."

This library provides a set of features from the discontinued [marlinspike](https://github.com/tjwebb/marlinspike), while adding safety features and resolving issues with Sails v1.


## What is this?
Barmecide is a helper module intended to allow Sails hooks to be written as standalone-capable projects, with models, services, controllers and configuration being _automagically_ merged in when loaded as a hook, or applied on their own when running otherwise.

Simply create a Sails project as normal, defining models, services, controllers and default configuration entries, extend the barmecide class when defining your hook, and you're pretty much set.

The Sails.js [hook specification document](https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification) defines the essential layout of barmecide hooks, with the caveat that `.defaults` may only use the function definition option, and `.routes` must be similarly defined. All fields are still optional.

An example barmecide hook can be seen below, with fairly thorough usage documentation:

```js
/**
 * @file index.js
 *
 * A sample barmecide hook definition.
 *
 * You'd typically either place this as the `index.js` within it's own npm package, to be
 * easily installed by end-users, or alternatively consume the hook through direct inclusion
 * in the hooks directory: `api/hooks/hookname/index.js`.
 */

const Barmecide = require('barmecide');

/**
 * Describes a basic Barmecide Sails hook.
 *
 * The order of callback execution goes something like:
 *
 * 1. defaults()
 *    a. Load and merge in config/**
 *       - Note that configuration will not be merged if the `barmecide.config` field would
 *         equal `false` following the merge operation.
 * 2. configure()
 *    a. Load and merge in api/models/**
 *    b. Load and merge in api/services/**
 *    c. Load and merge in api/policies/**
 * 3. routes()
 * 4. initialize()
 * 5. registerActions()
 *    a. Load and merge in api/controllers/**
 *    b. Issues a barmecide:hooks:{{HOOK NAME}}:loaded event (only ever issued once!).
 *
 * If no extra configuration or initialization is required, these methods may be left out
 * of your hook definition, as the Barmecide hook class provides default implementations.
 */
class HookName extends Barmecide.Hook {

    /**
     * Handles calling our Barmecide super method with our sails instance, along with the
     * executing module reference, used to load resources and dependencies.
     */
    constructor(sails) {
        super(sails, module);
    }

    /**
     * Used to handle any asynchronous code which must be executed for this hook to be considered
     * setup and ready for use.
     *
     * This will trigger a call to any defined `registerActions` method, which may be used to register
     * custom actions in addition to those loaded by found controller files.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/initialize
     */
    initialize(done) {
        return done();
    }

    /**
     * Used to handle registering any custom actions provided by this hook, aside from those loaded
     * automatically by the controller definitions. This function will be called upon initialization
     * and any time after `sails.reloadActions()` has been called, allowing actions to be refreshed
     * during runtime.
     *
     * Controllers will be loaded and merged in once the `done` callback is called. If this method
     * is not provided, then controllers will still be loaded in without issue.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/register-actions
     */
    registerActions(done) {
        return done();
    }

    /**
     * Used to handle any additional logic which should be performed once defaults and user set
     * values have been applied to the sails configuration object.
     *
     * Once this function has finished executing, any models, services and policy files will be
     * loaded in, provided these are enabled.
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/configure
     */
    configure() {
        if (this.sails.config[this.configKey].option === 'test') {
            // Do something..
        } else {
            // Do something else..
        }
    }

    /**
     * Used to define default values for the hook's configuration object. The `configKey`
     * field is useful for retrieving the appropriate configuration key name.
     *
     * Once this function has finished executing, any configuration files will be loaded
     * in and merged (provided the config field is set `true`).
     *
     * @see https://sailsjs.com/documentation/concepts/extending-sails/hooks/hook-specification/defaults
     */
    defaults() {
        return {
            [this.configKey]: {
                option: 'test',
            },
        };
    }

    /**
     * Used for defining any custom route handlers desired. This functionality makes it very
     * easy to add global or wildcarded listeners prior to running normal Sails action logic.
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

}

module.exports = Barmecide.createSailsHook(HookName);
```


## Usage

### How does loading order work out?

The hook loading order is generally based on the alphabetical order of encountered hooks. Some hooks are automatically loaded by Sails, while others are injected by Barmecide, in order to satisfy the dependencies of already loaded hooks.

The hook loading process can be summarised like so:

1. Hooks in the `api/hooks/` directory are loaded by Sails, if any exist.
    - All Barmecide hooks loaded through this process are setup without additional special handling.
2. Hook dependencies of the main project are loaded by Sails, if any exist.
    - A hook dependency is one where `sails.isHook` of the `package.json` is set to `true`.
    - Barmecide hooks loaded in this way currently go through no special handling, but in the future hooks will be retargetted to any newer versions existing in dependencies.
3. Any Barmecide hook dependencies of loaded hooks will be loaded by Barmecide, if necessary.
    - During dependency loading, duplicate hooks are ignored. Once all hooks have finished loading, any discovered versioning conflicts should be logged, so these may be solved.
        - In the future, rather than ignoring duplicates altogether, the duplicate with the highest version will be selected instead, with any attempt to load a lower version being retargetted to the selected hook.
        - Further, [node-semver](https://github.com/npm/node-semver) should be used to ensure that the loaded version does not violate any of the multiple `package.json` constraints for the duplicate hook. If a violation is discovered, the loading process should fail and terminate Sails.
    - **Caution**: Normal (non-barmecide) hooks will not be injected in this way, as this may not always be safe, and there is generally no trickling/merging behaviour as with Barmecide hook dependencies.
        - If auto-injection of normal hooks down the dependency tree is truly desired, please open an issue and assign it to [@Rua-Yuki](https://github.com/Rua-Yuki)–I'll have this feature added.


Regarding the loading process of individual hooks, take a look at the example hook above: the execution order of hook methods and the merging process is described in the class' JSDoc entry.

### Configuring Barmecide injection

If desired, the items injected by Barmecide may be configured on a per-hook basis. Any Barmecide behaviour may be altered for the hook by adjusting the `barmecide` settings field within the hook config object, though this must be done prior to the `configure()` call finishing.

The `barmecide` settings block may be used like so: 

```js
/**
 * A sample definition for configuring a Barmecide hook's loading preferences.
 *
 * Place this file in `config/hookname.js` and it'll be automatically loaded in after the
 * `defaults` hook method has executed.
 */
module.exports.hookname = {

    /**
     * Used to control Barmecide loading behavior.
     */
    barmecide: {
        /**
         * Whether or not controllers should be automatically loaded and merged in from the
         * `api/controllers/` directory.
         */
        controllers: true,

        /**
         * Whether or not models should be automatically loaded and merged in from the
         * `api/models/` directory.
         */
        models: true,

        /**
         * Whether or not services should be automatically loaded and merged in from the
         * `api/services/` directory.
         */
        services: true,

        /**
         * Whether or not policies should be automatically loaded and merged in from the
         * `api/policies/` directory.
         */
        policies: true,

        /**
         * Whether or not the configuration data from the `config/` directory should be
         * merged into the `sails.config` object.
         *
         * Please note the quirk when working with this field, that the merge condition
         * is based on a provisional merging between the current value of `sails.config`
         * and any loaded configs. If the `config` key is found to be `false` within the
         * merged object, it is discarded. Otherwise, the merged config will be applied.
         *
         * Because of this, one is likely better-off altering this field by the `defaults`
         * method, so there might be less ambiguity regarding configured loading behavior.
         */
        config: true,
    },

};
```

If the `barmecide` field is missing or incomplete, then the default scheme as shown above will be used in place of missing options.


## Why is this?

Having the option to create either micro-services or a full-fat API from one set of source code is super nice. Not only that, but with the automagic merging of modules provided by Barmecide provide for easy extension or decoupling of existing code.


## What's with the funky name?

This hook was originally named with the following definitions in mind:

> barmecide:
> 
> (adjective) illusory or imaginary and therefore disappointing.
> 
> (noun) a person who offers benefits that are illusory or disappointing.

Mostly, working with Marlinspike and Sails v0.12.14 had a hassle with circular and hook dependencies (though [gabagool](https://github.com/fpm-git/gabagool) did help alleviate this). With Sails v1, things got worse, to the point where important features were broken half the time–not cool.

Further, Marlinspike (and Sails to some extent) promote a few anti-patterns that make Yukis a little sad :scream: (though gabagool ~= happy).

It seemed like Marlinspike was causing more trouble than it was worth, and I *expected* this to be the case with Barmecide as well. I was wrong; Barmecide is pretty cool and provides some noice benefits.

*You're gonna like the way you hook, I guarantee it.*
