const expect = require('chai').expect;
const nock = require('nock');

const { createAssetPath, createBulkPath, getFileStream, createPath } = require('../lib/util');

describe('util', () => {
  describe('getFileStream', () => {
    it('should return base path with no arguments passed', () => {
      const path = createBulkPath();

      expect(path).to.equal('/../bulk/v1');
    });
  });

  describe('createBulkPath', () => {
    it('should create a bulk path correctly', () => {
      const path = createBulkPath('activities', 'export', 'create.json');

      expect(path).to.equal('/../bulk/v1/activities/export/create.json');
    });

    it('should create a bulk path correctly even when given one arg', () => {
      const path = createBulkPath('activities.json');

      expect(path).to.equal('/../bulk/v1/activities.json');
    });
  });

  describe('createAssetPath', () => {
    it("builds an asset path correctly", () => {
        const path = createAssetPath("another", "resource.json");

        expect(path).to.equal("/asset/v1/another/resource.json");
    });

    it("builds an asset path correctly given one arg", () => {
        const path = createAssetPath("resource.json");

        expect(path).to.equal("/asset/v1/resource.json");
    });
  });

  describe('createPath', () => {
    it("builds a path when given multiple args", () => {
      expect(createPath("activities", "external.json")).to.equal("/v1/activities/external.json");
    });

    it("builds a path given one arg", () => {
      expect(createPath("activities.json")).to.equal("/v1/activities.json");
    });
  });
});
