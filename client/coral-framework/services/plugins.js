import React from 'react';
import uniq from 'lodash/uniq';
import pick from 'lodash/pick';
import merge from 'lodash/merge';
import flattenDeep from 'lodash/flattenDeep';
import isEmpty from 'lodash/isEmpty';
import flatten from 'lodash/flatten';
import mapValues from 'lodash/mapValues';
import {getDisplayName} from 'coral-framework/helpers/hoc';
import camelize from '../helpers/camelize';
import uuid from 'uuid/v4';

// This is returned for pluginConfig when it is empty.
const emptyConfig = {};

// Memoize the warnings so we only show them once.
const memoizedWarnings = [];

// withWarnings decorates the props of queryData with a proxy that
// prints a warning when accessing deeper props.
function withWarnings(component, queryData) {
  if (process.env.NODE_ENV !== 'production' && window.Proxy) {

    // Show warnings when accessing queryData only when not in production.
    return mapValues(queryData, (value, key) => {

      // Keep null values..
      if (!queryData[key]) {
        return queryData[key];
      }
      return new Proxy(queryData[key], {
        get(target, name) {

          // Detect access from React DevTools and ignore those.
          const error = new Error();
          const accessFromDevTools = ['backend.js', 'dehydrate']
            .every((keyword) => error.stack && error.stack.includes(keyword));

          // Only care about the components defined in the plugins.
          if (component.talkPluginName && !accessFromDevTools) {
            const warning = `'${getDisplayName(component)}' of '${component.talkPluginName}' accessed '${key}.${name}' but did not define fragments using the withFragment HOC`;
            if (memoizedWarnings.indexOf(warning) === -1) {
              console.warn(warning);
              memoizedWarnings.push(warning);
            }
          }
          return queryData[key][name];
        }
      });
    });
  }

  return queryData;
}

function addMetaDataToSlotComponents(plugins) {

  // Add talkPluginName to Slot Components.
  plugins.forEach((plugin) => {
    const slots = plugin.module.slots;
    slots && Object.keys(slots).forEach((slot) => {
      slots[slot].forEach((component) => {

        // Attach plugin name to the component
        component.talkPluginName = plugin.name;

        // Attach uuid to the component
        component.talkUuid = uuid();
      });
    });
  });
}

class PluginsService {
  constructor(plugins) {
    this.plugins = plugins;
    addMetaDataToSlotComponents(plugins);
  }

  getSlotComponents(slot, reduxState, props = {}, queryData = {}) {
    const pluginConfig = reduxState.config.plugin_config || emptyConfig;
    return flatten(this.plugins

      // Filter out components that have slots and have been disabled in `plugin_config`
      .filter((o) => o.module.slots && (!pluginConfig || !pluginConfig[o.name] || !pluginConfig[o.name].disable_components))

      .filter((o) => o.module.slots[slot])
      .map((o) => o.module.slots[slot])
    )
      .filter((component) => {
        if(!component.isExcluded) {
          return true;
        }
        let resolvedProps = this.getSlotComponentProps(component, reduxState, props, queryData);
        if (component.mapStateToProps) {
          resolvedProps = {...resolvedProps, ...component.mapStateToProps(reduxState)};
        }
        return !component.isExcluded(resolvedProps);
      });
  }

  isSlotEmpty(slot, reduxState, props = {}, queryData = {}) {
    return this.getSlotComponents(slot, reduxState, props, queryData).length === 0;
  }

  /**
   * getSlotComponentProps calculate the props we would pass to the slot component.
   * query datas are only passed to the component if it is defined in `component.fragments`.
   */
  getSlotComponentProps(component, reduxState, props, queryData) {
    const pluginConfig = reduxState.config.plugin_config || emptyConfig;
    return {
      ...props,
      config: pluginConfig,
      ...(
        component.fragments
          ? pick(queryData, Object.keys(component.fragments))
          : withWarnings(component, queryData)
      )
    };
  }

  /**
   * Returns React Elements for given slot.
   */
  getSlotElements(slot, reduxState, props = {}, queryData = {}) {
    return this.getSlotComponents(slot, reduxState, props, queryData)
      .map((component, i) => {
        return React.createElement(component, {key: i, ...this.getSlotComponentProps(component, reduxState, props, queryData)});
      });
  }

  getSlotFragments(slot, part) {
    const components = uniq(flattenDeep(this.plugins
      .filter((o) => o.module.slots ? o.module.slots[slot] : false)
      .map((o) => o.module.slots[slot])
    ));

    const documents = components
      .map((c) => c.fragments)
      .filter((fragments) => fragments && fragments[part])
      .reduce((res, fragments) => {
        res.push(fragments[part]);
        return res;
      }, []);

    return documents;
  }

  getGraphQLExtensions() {
    return this.plugins
      .map((o) => pick(o.module, ['mutations', 'queries', 'fragments']))
      .filter((o) => !isEmpty(o));
  }

  getModQueueConfigs() {
    return merge(...this.plugins
      .map((o) => o.module.modQueues)
      .filter((o) => o));
  }

  getTranslations() {
    return this.plugins
      .map((o) => o.module.translations)
      .filter((o) => o);
  }

  getReducers() {
    return merge(
      ...this.plugins
        .filter((o) => o.module.reducer)
        .map((o) => ({[camelize(o.name)] : o.module.reducer}))
    );
  }
}

/**
 * createPluginsService returns a plugins service.
 * @param  {Array}   plugins config as returned from importing `pluginsConfig`
 * @return {Object}  plugins service
 */
export function createPluginsService(pluginsConfig) {
  return new PluginsService(pluginsConfig);
}
