
const fs = require('fs');
const includeAll = require('include-all');
const _ = require('lodash');

module.exports = {

    loadConfig(path) {
        const config = fs.existsSync(path) && fs.statSync(path).isDirectory ? includeAll({
            dirname: path,
            excludeDirs: /^env$/,
            recursive: true,
            flatten: true,
        }) : {};

        // Handle mapping values to just their exported config block names, rather than filename.exportName.
        return Object.values(config).reduce((acc, val) => {
            return Object.assign(acc, val);
        }, {});
    },

    loadControllers(sails, path) {
        // Import any raw controller definitons.
        const controllers = fs.existsSync(path) && fs.statSync(path).isDirectory ? includeAll({
            dirname: path,
            filter: new RegExp('(.+)Controller\\.js$'),
            flatten: true,
            keepDirectoryPath: true,
        }) : {};

        // Handle action registration for each controller.
        Object.keys(controllers).forEach(controllerName => {
            const controller = controllers[controllerName];
            const controllerIdent = controllerName.toLowerCase().replace(/\\/g, '/');

            // Loop through all fields, though we'll handle only actions (functions).
            Object.keys(controller).forEach(actionName => {
                const action = controller[actionName];
                const actionIdent = `${controllerIdent}/${actionName.toLowerCase()}`;

                // Skip if this isn't actually an action.
                if (!(action instanceof Function)) {
                    return;
                }

                // Otherwise, all good, register it.
                return sails.registerAction(action, actionIdent);
            });

            // If the controller has options specified, take care to merge those in.
            if (controller._config instanceof Object) {
                // Ensure the controller's settings field is a proper object.
                sails.config.blueprints._controllers[controllerIdent] = (sails.config.blueprints._controllers[controllerIdent] instanceof Object)
                    ? sails.config.blueprints._controllers[controllerIdent]
                    : {};
                // Handle the actual merging.
                _.merge(sails.config.blueprints._controllers[controllerIdent], controller._config);
            }
        });

        return controllers;
    },

    loadModels(sails, path) {
        // Import the raw model definitions.
        const models = fs.existsSync(path) && fs.statSync(path).isDirectory ? includeAll({
            dirname: path,
            filter: /^(.+)\.(?:(?!md|txt).)+$/,
            replaceExpr: /^.*\//,
            flatten: true,
        }) : {};

        // Add the target models path to our list of loaded model directories (so we can patch these later). @Poop.
        if (!sails.barmecide.modelDirectories.includes(path)) {
            sails.barmecide.modelDirectories.push(path);
        }

        // Transform the models so Sails is happy with them.
        const transformedModels = {};
        Object.keys(models).forEach(modelName => {
            const ident = modelName.toLowerCase();
            transformedModels[ident] = Object.assign(models[modelName], {
                globalId: modelName,
                identity: ident,
            });

            // Add a reference to the module, so we can replace this instance in addition to the later required copy.
            sails.barmecide.modelModules.push({ identity: ident, module: models[modelName] });
        });

        // Merge in the transformed models.
        _.merge(sails.config.orm.moduleDefinitions.models, transformedModels);

        return transformedModels;
    },

    loadServices(sails, path) {
        // Load all raw service definitions.
        const services = fs.existsSync(path) && fs.statSync(path).isDirectory ? includeAll({
            dirname: path,
            filter: /^(.+)\.(?:(?!md|txt).)+$/,
            depth: 1,
            caseSensitive: true,
        }) : {};

        // Transform the services so Sails is happy with them.
        const transformedServices = {};
        Object.keys(services).forEach(modelName => {
            const ident = modelName.toLowerCase();
            transformedServices[ident] = Object.assign({
                globalId: modelName,
                identity: ident,
            }, services[modelName]);
        });

        // Merge in our transformed services.
        _.merge(sails.services, transformedServices);

        return transformedServices;
    },

    /**
     * @todo Implement?
     */
    loadPolicies(_sails, _path) {
        // I'm not sure this should be implemented, given Floatperms is much more hook-friendly
        // and generally safer to use over policies...
    },

};
