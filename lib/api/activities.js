var _ = require('lodash'),
  Promise = require('bluebird'),
  util = require('../util'),
  log = util.logger();

function Activities(marketo, connection) {
  this._marketo = marketo;
  this._connection = connection;
}

Activities.prototype = {
  getActivityTypes: function () {
    var path = util.createPath('activities', 'types.json');

    return this._connection.get(path, { _method: 'GET' });
  },

  addCustomActivities: function(input) {
    if (!_.isArray(input) && !_.isEmpty(input)) {
      var msg = 'input must be an array of customActivityRequest-formatted objects';
      log.error(msg);
      return Promise.reject(msg);
    }

    var data = _.extend({}, options, { input })
    var path = util.createPath('activities', 'external.json');

    return this._connection.post(path, data).then(function (data) {
      if (data.success) {
        return data
      } else {
        log.warn('Cannot push activity: ', data);
        return Promise.reject('Cannot push activity from input: ' + JSON.stringify(input))
      }
    });
  }
};

module.exports = Activities;
