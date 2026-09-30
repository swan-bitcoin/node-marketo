var assert = require('assert'),
  nock = require('nock'),
  errors = require('../lib/errors'),
  Connection = require('../lib/connection'),
  HOST = 'http://localhost-mock',
  IDENTITY_PATH = '/identity',
  TOKEN_PATH = IDENTITY_PATH + '/oauth/token';

var now, realDateNow, tokenRequests;

function getConnection() {
  return new Connection({
    endpoint: HOST + '/rest/v1',
    identity: HOST + IDENTITY_PATH,
    clientId: 'someId',
    clientSecret: 'someSecret',
    // Keep the backoff out of the way, these tests are not about retry timing
    retry: { maxRetries: 1, initialDelay: 1, maxDelay: 2 },
  });
}

// Counts the token fetches that actually hit the wire
function stubToken(body) {
  return nock(HOST)
    .get(TOKEN_PATH)
    .query(true)
    .reply(200, function () {
      tokenRequests += 1;
      return body;
    });
}

// Resolves with the rejection reason, and fails if the promise resolves
function expectRejection(promise) {
  return promise.then(
    function () {
      throw new Error('expected the promise to reject');
    },
    function (err) {
      return err;
    }
  );
}

describe('OAuth token', function () {
  beforeEach(function () {
    nock.cleanAll();
    tokenRequests = 0;
    now = 1600000000000;
    realDateNow = Date.now;
    Date.now = function () {
      return now;
    };
  });

  afterEach(function () {
    Date.now = realDateNow;
    nock.cleanAll();
  });

  it('fetches the token once for two sequential calls', function () {
    stubToken({ access_token: 'first', expires_in: 3600 });
    stubToken({ access_token: 'second', expires_in: 3600 });

    var connection = getConnection();
    return connection
      .getOAuthToken()
      .then(function () {
        return connection.getOAuthToken();
      })
      .then(function (token) {
        assert.equal(token.access_token, 'first');
        assert.equal(tokenRequests, 1);
      });
  });

  it('refetches once the cached token has expired', function () {
    stubToken({ access_token: 'first', expires_in: 3600 });
    stubToken({ access_token: 'second', expires_in: 3600 });

    var connection = getConnection();
    return connection
      .getOAuthToken()
      .then(function () {
        // Past the safety margin, so the cached token is no longer usable
        now += (3600 - 60) * 1000;
        return connection.getOAuthToken();
      })
      .then(function (token) {
        assert.equal(token.access_token, 'second');
        assert.equal(tokenRequests, 2);
      });
  });

  it('refetches when forced, even with a fresh cached token', function () {
    stubToken({ access_token: 'first', expires_in: 3600 });
    stubToken({ access_token: 'second', expires_in: 3600 });

    var connection = getConnection();
    return connection
      .getOAuthToken()
      .then(function () {
        return connection.getOAuthToken(true);
      })
      .then(function (token) {
        assert.equal(token.access_token, 'second');
        assert.equal(tokenRequests, 2);
      });
  });

  it('does not cache a token that has no expires_in', function () {
    stubToken({ access_token: 'first' });
    stubToken({ access_token: 'second', expires_in: 3600 });

    var connection = getConnection();
    return connection
      .getOAuthToken()
      .then(function (token) {
        assert.equal(token.access_token, 'first');
        return connection.getOAuthToken();
      })
      .then(function (token) {
        assert.equal(token.access_token, 'second');
        assert.equal(tokenRequests, 2);
      });
  });

  it('clears the cached token when a fetch fails', function () {
    stubToken({ access_token: 'first', expires_in: 3600 });
    nock(HOST).get(TOKEN_PATH).query(true).reply(401, {
      error: 'invalid_client',
      error_description: 'Bad client credentials',
    });
    stubToken({ access_token: 'second', expires_in: 3600 });

    var connection = getConnection();
    return connection
      .getOAuthToken()
      .then(function () {
        return expectRejection(connection.getOAuthToken(true));
      })
      .then(function () {
        assert.equal(connection._tokenData, null);
        return connection.getOAuthToken();
      })
      .then(function (token) {
        assert.equal(token.access_token, 'second');
        assert.equal(tokenRequests, 2);
      });
  });

  it('reports the reason a 401 auth failure gives', function () {
    nock(HOST).get(TOKEN_PATH).query(true).reply(401, {
      error: 'invalid_client',
      error_description: 'Bad client credentials',
    });

    var connection = getConnection();
    return expectRejection(connection.get('/some_path')).then(function (err) {
      assert.equal(
        err.message,
        'Authentication (invalid_client): Bad client credentials'
      );
      // The original axios error survives, so retry.js can still inspect it
      assert.equal(err.response.status, 401);
    });
  });

  it('reports a timeout that carries no response body', function () {
    nock(HOST).get(TOKEN_PATH).query(true).times(20).replyWithError({
      message: 'timeout of 20000ms exceeded',
      code: 'ETIMEDOUT',
    });

    var connection = getConnection();
    return expectRejection(connection.get('/some_path')).then(function (err) {
      assert.equal(
        err.message,
        'Authentication (ETIMEDOUT): timeout of 20000ms exceeded'
      );
    });
  });

  it('treats an axios error with a 503 response as a server error', function () {
    var err = new Error('Request failed with status code 503');
    err.code = 'ERR_BAD_RESPONSE';
    err.response = { status: 503 };

    assert.equal(errors.isServerError(err), true);
  });
});
