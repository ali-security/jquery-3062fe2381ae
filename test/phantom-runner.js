/*
 * Headless runner for the jQuery QUnit suite.
 *
 * jQuery 1.11.1 shipped no CI test runner: upstream drove test/index.html
 * through TestSwarm against a browser farm, so `npm test` (grunt) only lints
 * and builds. This script runs the same test/index.html under the PhantomJS
 * that Travis provides, reporting per-test results and exiting non-zero on any
 * failure, so the suite actually executes in CI.
 *
 * Usage: phantomjs test/phantom-runner.js <url>
 */

/*jshint browser:true */
/*global phantom:false, require:false */

var page = require( "webpage" ).create(),
	system = require( "system" ),

	target = system.args[ 1 ],

	// The full suite is several thousand assertions; PhantomJS 1.9 needs a few
	// minutes for it. Travis kills a job after 10 minutes of silence, so a
	// heartbeat is printed below as well.
	TIMEOUT_MS = 10 * 60 * 1000,
	HEARTBEAT_MS = 30 * 1000,

	started = new Date().getTime(),
	lastBeat = started,
	done = null;

if ( !target ) {
	console.log( "usage: phantomjs test/phantom-runner.js <url>" );
	phantom.exit( 1 );
}

page.onConsoleMessage = function( msg ) {
	console.log( msg );
};

page.onError = function( msg, trace ) {
	var line = "PAGE ERROR: " + msg;
	if ( trace && trace.length ) {
		line += " (" + trace[ 0 ].file + ":" + trace[ 0 ].line + ")";
	}
	console.log( line );
};

// QUnit does not exist yet when the page is initialized, so poll for it and
// attach the reporting callbacks the moment it appears -- before QUnit.load
// runs, so no test result is missed.
page.onInitialized = function() {
	page.evaluate( function() {
		var waiting = setInterval(function() {
			if ( !window.QUnit || !window.QUnit.testDone ) {
				return;
			}
			clearInterval( waiting );

			window.QUnit.testDone(function( result ) {
				var name = ( result.module ? result.module + ": " : "" ) + result.name;
				console.log(
					( result.failed > 0 ? "not ok - " : "ok - " ) + name +
					" (" + result.passed + "/" + result.total + " assertions)"
				);
			});

			window.QUnit.log(function( details ) {
				if ( !details.result ) {
					console.log(
						"    FAILED assertion in " +
						( details.module ? details.module + ": " : "" ) + details.name +
						" -- " + ( details.message || "(no message)" ) +
						( details.expected !== undefined ?
							" | expected: " + QUnit.jsDump.parse( details.expected ) +
							" | actual: " + QUnit.jsDump.parse( details.actual ) :
							"" )
					);
				}
			});

			window.QUnit.done(function( summary ) {
				window.__phantomDone = {
					failed: summary.failed,
					passed: summary.passed,
					total: summary.total,
					runtime: summary.runtime
				};
			});
		}, 10 );
	});
};

page.open( target, function( status ) {
	if ( status !== "success" ) {
		console.log( "Unable to load " + target );
		phantom.exit( 1 );
	}

	setInterval(function() {
		var now = new Date().getTime();

		done = page.evaluate(function() {
			return window.__phantomDone || null;
		});

		if ( done ) {
			console.log( "" );
			console.log(
				"QUnit results: " + done.total + " assertions, " +
				done.passed + " passed, " + done.failed + " failed, in " +
				done.runtime + "ms"
			);
			phantom.exit( done.failed > 0 ? 1 : 0 );
			return;
		}

		if ( now - lastBeat >= HEARTBEAT_MS ) {
			lastBeat = now;
			console.log( "... still running (" +
				Math.round( ( now - started ) / 1000 ) + "s elapsed)" );
		}

		if ( now - started > TIMEOUT_MS ) {
			console.log( "Timed out after " + ( TIMEOUT_MS / 1000 ) + "s" );
			phantom.exit( 1 );
		}
	}, 1000 );
});
