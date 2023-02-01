var https = require('https'),
  _ = require('lodash'),
  bunyan = require('bunyan'),
  config = require('../config'),
  logger,
  logConfig;

logConfig = {
  name: config.name,
  streams: [
    {
      level: 'warn',
      stream: process.stderr,
    },
    {
      level: 'debug',
      stream: process.stderr,
    },
  ],
};

const createBulkPath = (...pathParts) => {
  let path = pathParts;
  path.unshift('/../bulk' + config.api.version);

  return path.join('/');
};

module.exports = {
  createAssetPath: function joinPath(...pathParts) {
    let path = pathParts;
    path.unshift('/asset' + config.api.version);

    return path.join('/');
  },

  createPath: function joinPath(...pathParts) {
    let path = pathParts;
    path.unshift(config.api.version);

    return path.join('/');
  },

  createBulkPath: createBulkPath,

  logger: function () {
    if (!logger) {
      logger = bunyan.createLogger({ name: config.name });
      if (process.env.NODE_MARKETO_LOG_LEVEL) {
        logger.level(bunyan.resolveLevel(process.env.NODE_MARKETO_LOG_LEVEL));
      }
    }
    return logger;
  },

  arrayToCSV: function (options, keys) {
    var copy = _.clone(options);
    _.each(keys, function (key) {
      if (_.isArray(copy[key])) {
        copy[key] = copy[key].join(',');
      }
    });
    return copy;
  },

  formatOptions: function (options, opt_filterArray) {
    options = _.clone(options);

    if (opt_filterArray) {
      options = _.pick(options, opt_filterArray);
    }

    return this.arrayToCSV(options, ['fields', 'filterValues']);
  },

  nextPageType: function (requestedUrl) {
    var type = 'token';
    if (requestedUrl.indexOf('asset') !== -1) {
      type = 'offset';
    }
    return type;
  },
};
