var _ = require('lodash'),
  axios = require('axios'),
  Promise = require('bluebird'),
  Retry = require('./retry'),
  errors = require('./errors'),
  getNextPageFn = require('./nextPageFn'),
  util = require('util'),
  helper = require('./util'),
  EventEmitter = require('events').EventEmitter,
  log = require('./util').logger(),
  methods = ['get', 'post', 'put', 'delete'];

var OAUTH_TOKEN_PATH = '/oauth/token';

// Refetch this long before Marketo's stated expires_in, so a request that
// starts just under the wire does not race the expiry.
var TOKEN_SAFETY_MARGIN_SECONDS = 60;

// Marketo hands back the same token with a shrinking expires_in, so a fixed
// margin would put the expiry in the past near the end of a token's life and
// leave the cache cold. Cap the margin at half the remaining life.
function tokenExpiresAt(data, nowMs) {
  var expiresIn = data && data.expires_in;
  if (typeof expiresIn !== 'number' || !isFinite(expiresIn) || expiresIn <= 0) {
    log.warn(
      'Marketo returned an unusable expires_in, not caching: ',
      expiresIn
    );
    return 0;
  }
  var marginSeconds = Math.min(TOKEN_SAFETY_MARGIN_SECONDS, expiresIn / 2);
  return nowMs + (expiresIn - marginSeconds) * 1000;
}

function Connection(options) {
  EventEmitter.call(this);
  this._options = options || {};
  this._tokenData = null;
  this._tokenExpiresAt = 0;
  this._retry = new Retry(options.retry || {});
  this.apiCallCount = 0;

  // Convenient methods, matches that of restler's
  _.forEach(methods, (method) => {
    this[method] = function () {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(method);
      return this._request.apply(this, args);
    };
  });
}

util.inherits(Connection, EventEmitter);

/**
 * This function is just a helper function that delegates everything to
 * restler, but returns a Promise instead of going with the existing event
 * based responses.
 */
Connection.prototype._request = function (method) {
  var args = Array.prototype.slice.call(arguments, 1),
    url = _.first(args);

  // If the url does not start with http(s)://, then assume that it's an
  // absolute path from options.endpoint
  if (!/^https?:\/\//i.test(url)) {
    url = this._options.endpoint + url;
  }

  this.apiCallCount += 1;
  this.emit('apiCall', { apiCallCount: this.apiCallCount });

  var requestFn = function requestFn(forceOAuth) {
    return this.getOAuthToken(forceOAuth).then(
      function (token) {
        var [_a, data] = args;

        var nextPageFn = getNextPageFn(this, method, args);

        options = {};
        options.headers = _.extend({}, data.headers, {
          Authorization: 'Bearer ' + token.access_token,
        });
        options.url = url;
        options.method = method;
        // This params works but we still must clean `data` -- it still contains params
        // {
        // headers: { Authorization: 'Bearer xxx' },
        // url: 'https://875-XKQ-634.mktorest.com/rest/v1/lead/2.json',
        // method: 'get',
        // params: { fields: 'email,title' },
        // data: { params: { fields: 'email,title' } } // <------
        // }
        // options.params = data.params
        options.data = data;

        return new Promise((resolve, reject) => {
          return axios(options)
            .then(function ({ status, data }) {
              if (data.success === false && _.has(data, 'errors')) {
                log.debug('Request failed: ', data);
                reject(new errors.HttpError(status, data));
              } else {
                if (helper.nextPageType(args[0]) === 'offset') {
                  if (!_.isEmpty(data.result)) {
                    Object.defineProperty(data, 'nextPage', {
                      enumerable: false,
                      value: _.partial(nextPageFn),
                    });
                  }
                } else {
                  if (_.has(data, 'nextPageToken')) {
                    Object.defineProperty(data, 'nextPage', {
                      enumerable: false,
                      value: _.partial(nextPageFn, data.nextPageToken),
                    });
                  }
                }

                resolve(data);
              }
            })
            .catch((err) => {
              const statusCode = err?.response?.status;
              const httpError = new errors.HttpError(statusCode);
              reject(statusCode ? httpError : err);
            });
        });
      }.bind(this),
      function (e) {
        // Keep the original error so retry.js can still read code/errors;
        // only the message changes.
        e.message = 'Authentication (' + e.error + '): ' + e.error_description;
        throw e;
      }
    );
  };

  return this._retry.start(requestFn, this);
};

Connection.prototype.getOAuthToken = function (force) {
  force = force || false;

  if (!force && this._tokenData != null && Date.now() < this._tokenExpiresAt) {
    log.debug('Using existing token');
    return Promise.resolve(this._tokenData);
  }

  var requestFn = function () {
    var getOptions = {
      params: this._getTokenQuery(),
      timeout: this._options.timeout || 20000,
    };
    return axios
      .get(this._options.identity + OAUTH_TOKEN_PATH, getOptions)
      .then(({ data }) => {
        this._tokenData = data;
        this._tokenExpiresAt = tokenExpiresAt(data, Date.now());
        return data;
      })
      .catch((err) => {
        this._tokenData = null;
        this._tokenExpiresAt = 0;
        throw errors.decorateOAuthError(err);
      });
  };

  return this._retry.start(requestFn, this);
};

Connection.prototype._getTokenQuery = function () {
  var queryOptions = {
    grant_type: 'client_credentials',
    client_id: this._options.clientId,
    client_secret: this._options.clientSecret,
  };
  var partnerId = this._options.partnerId;
  if (partnerId) {
    queryOptions.partner_id = partnerId;
  }
  return queryOptions;
};

Connection.prototype.getEndpoint = function () {
  return this._options.endpoint;
};

module.exports = Connection;
