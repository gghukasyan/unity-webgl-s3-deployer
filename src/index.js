#! /usr/bin/env node

var s3 = require('s3');
var fs = require('fs');
var path = require('path');
var glob = require('glob');
var nodemailer = require('nodemailer');
var sesTransport = require('nodemailer-ses-transport');

var argv = require('optimist')
	.usage('Deploys unity webgl folder to server.\nUsage webgl-s3-deploy --src /PATH/TO/SRC --bucket BUCKET_NAME --key AWS_KEY --secret AWS_SECRET')
	.demand('src')
	.demand('bucket')
	.demand('key')
	.demand('secret')
	.string('src')
	.string('bucket')
	.string('key')
	.string('secret')
	.describe('src', 'Folder exported by unity, containing index.html and Compressed, Release folders.')
	.describe('bucket', 'S3 bucket to deploy folder to.')
	.describe('key', 'AWS access key')
	.describe('secret', 'AWS access secret')
	.argv;

var source = argv.src;
var bucket = argv.bucket;
var syncDir = source + "/sync";

console.log("Deploying " + source + " to " + bucket);
console.log("Key " + argv.key);
console.log("Secret " + argv.secret);

var s3Client = s3.createClient({
	maxAsyncS3: 20,
	s3RetryCount: 3,
	s3RetryDelay: 1000,
	multipartUploadThreshold: 90971520,
	multipartUploadSize: 95728640,
	s3Options: {
		accessKeyId: argv.key,
		secretAccessKey: argv.secret
	}
});

function startDeployment(){
	createSyncDirectory();
	clearS3();
}

function createSyncDirectory(){
	var compressedFiles = glob.sync(source + "/Compressed/*");
	deleteFolderRecursive(syncDir);
	fs.mkdirSync(syncDir);
	fs.mkdirSync(syncDir + "/Release");
	fs.writeFileSync(
		syncDir + "/index.html",
		fs.readFileSync(source + "/index.html")
	);
	for(var i = 0; i < compressedFiles.length; i++){
		var file = compressedFiles[i];
		var fileName = path.basename(file);
		var targetFileName = fileName.replace(new RegExp('gz$'), '');
		fs.writeFileSync(syncDir + "/Release/"+targetFileName, fs.readFileSync(file));
	}
}


function clearS3(){
	clearIndexS3();
}

function clearIndexS3(){
	var params = {
		Bucket: bucket,
		Delete:{
			Objects:[{Key:"index.html"}]
		}
	};
	var deleter = s3Client.deleteObjects(params);
	deleter.on('end', function() {
		clearReleaseS3();
	});
}

function clearReleaseS3(){
	var params = {
		Bucket: bucket,
		Prefix:"Release"
	};
	var deleter = s3Client.deleteDir(params);
	deleter.on('end', function() {
		syncIndexS3();
	});
}


function syncIndexS3() {
	var params = {
		localFile: syncDir + "/index.html",
		deleteRemoved: true,
		s3Params: {
			Bucket: bucket,
			Key: "index.html",
			ACL:"public-read"
		}
	};
	var uploader = s3Client.uploadFile(params);
	uploader.on('error', function(err) {
		console.error("unable to sync:", err.stack);
	});
	uploader.on('progress', function() {
		process.stdout.write("progress " + uploader.progressAmount + "/" + uploader.progressTotal + "\r");
	});
	uploader.on('end', function() {
		syncReleaseS3();
	});
}

function syncReleaseS3(){
	var params = {
		localDir: syncDir + "/Release",
		deleteRemoved: true,
		s3Params: {
			Bucket: bucket,
			Prefix: "Release/",
			ContentEncoding: 'gzip',
			ACL:"public-read"
		}
	};
	var uploader = s3Client.uploadDir(params);
	uploader.on('error', function(err) {
		console.error("unable to sync:", err.stack);
	});
	uploader.on('progress', function() {
		process.stdout.write("progress " + uploader.progressAmount + "/" + uploader.progressTotal + "\r");
	});
	uploader.on('end', function() {
		deleteFolderRecursive(syncDir);
		sendDeploymentMail();
		console.log("done uploading");
	});
}

function sendDeploymentMail(){
	var transporter = nodemailer.createTransport(sesTransport({
		accessKeyId: argv.key,
		secretAccessKey: argv.secret,
		rateLimit: 4
	}));
	var mailOptions = {
		from: 'deployment@doublecoconut.com',
		to: 'vincideploy@doublecoconut.com',
		subject: 'Deployment Completed',
		html: '<div>Hi Team,</div>' +
		'<div>New version Of <b>' + bucket +'</b> uploaded.</div> ' +
		'<div>Click <a href="http://s3.amazonaws.com/' + bucket + '/index.html">here</a> to open game.</div>' +
		'<div>Double Coconut Team</div>'
	};
	transporter.sendMail(mailOptions, function(error, info){
		if(error){
			console.log(error);
		}else{
			console.log('Message sent: ' + info.response);
		}
	});
}

function deleteFolderRecursive(path) {
	if( fs.existsSync(path) ) {
		fs.readdirSync(path).forEach(function(file){
			var curPath = path + "/" + file;
			if(fs.lstatSync(curPath).isDirectory()) { // recurse
				deleteFolderRecursive(curPath);
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		});
		fs.rmdirSync(path);
	}
}

startDeployment();