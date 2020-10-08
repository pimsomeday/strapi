'use strict';

/**
 * Loaders.js service
 *
 * @description: A set of functions similar to controller's actions to avoid code duplication.
 */

const _ = require('lodash');
const DataLoader = require('dataloader');

module.exports = {
  loaders: {},

  initializeLoader() {
    this.resetLoaders();

    // Create loaders for each relational field (exclude core models).
    Object.keys(strapi.models)
      .filter(model => model.internal !== true)
      .forEach(modelKey => {
        const model = strapi.models[modelKey];
        this.createLoader(model.uid);
      });

    // Reproduce the same pattern for each plugin.
    Object.keys(strapi.plugins).forEach(plugin => {
      Object.keys(strapi.plugins[plugin].models).forEach(modelKey => {
        const model = strapi.plugins[plugin].models[modelKey];
        this.createLoader(model.uid);
      });
    });

    // Add the loader for the AdminUser as well, so we can query `created_by` and `updated_by` AdminUsers
    this.createLoader('strapi::user');
  },

  resetLoaders() {
    this.loaders = {};
  },

  createLoader(modelUID) {
    if (this.loaders[modelUID]) {
      return this.loaders[modelUID];
    }

    const loadFn = keys => this.batchQuery(modelUID, keys);
    const loadOptions = {
      cacheKeyFn: key => this.serializeKey(key),
    };

    this.loaders[modelUID] = new DataLoader(loadFn, loadOptions);
  },

  serializeKey(key) {
    return _.isObjectLike(key) ? JSON.stringify(_.cloneDeep(key)) : key;
  },

  async batchQuery(modelUID, keys) {
    // Extract queries from keys and merge similar queries.
    const queries = this.extractQueries(modelUID, _.cloneDeep(keys));

    // Run queries in parallel.
    const results = await Promise.all(queries.map(query => this.makeQuery(modelUID, query)));

    // Use to match initial queries order.
    return this.mapData(keys, results);
  },

  mapData(keys, results) {
    return keys.map((query, index) => {
      const data = results[index];

      if (query.single) {
        return _.first(data);
      }

      return data;
    });
  },

  async makeQuery(modelUID, query = {}) {
    if (_.isEmpty(query.ids)) {
      return [];
    }

    const params = {
      ...query.options,
    };

    params[`${query.alias}_in`] = _.chain(query.ids)
      .filter(id => !_.isEmpty(id) || _.isInteger(id))
      .map(_.toString)
      .uniq()
      .value();

    return strapi.query(modelUID).find(params, []);
  },

  extractQueries(modelUID, keys) {
    return keys.map(current => {
      // Extract query options.
      // Note: the `single` means that we've only one entry to fetch.
      const { single = false, params = {}, association } = current;
      const { query = {}, ...options } = current.options || {};

      // Retrieving referring model.
      const { primaryKey } = strapi.getModel(modelUID);

      // Generate array of IDs to fetch.
      const ids = [];

      // Only one entry to fetch.
      if (single) {
        ids.push(params[primaryKey]);
      } else if (_.isArray(query[primaryKey])) {
        ids.push(...query[primaryKey]);
      } else {
        ids.push(query[association.via]);
      }

      return {
        ids,
        options,
        alias: _.first(Object.keys(query)) || primaryKey,
      };
    });
  },
};
