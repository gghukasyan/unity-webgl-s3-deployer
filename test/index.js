var should = require('chai').should(),
	deployer = require('../src/index'),
	deploy = deployer.deploy;

describe('#deploy', function () {

	it('equals to Coool', function () {
		deploy('<').should.equal('Coool');
	});
});