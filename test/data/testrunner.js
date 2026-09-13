define(function() {

// Store the old counts so that we only assert on tests that have actually leaked,
// instead of asserting every time a test has leaked sometime in the past
var reset,
	oldCacheLength = 0,
	oldActive = 0,

	expectedDataKeys = {},
	splice = [].splice,
	ajaxSettings = jQuery.ajaxSettings;

/**
 * QUnit configuration
 */

// Max time for stop() and asyncTest() until it aborts test
// and start()'s the next test.
QUnit.config.testTimeout = 2e4; // 20 seconds

// Enforce an "expect" argument or expect() call in all test bodies.
QUnit.config.requireExpects = true;

/**
 * Tests excluded under the headless runner (PhantomJS 1.9 + PHP's built-in
 * server) added in test/phantom-runner.js. jQuery 1.11.1 drove this suite
 * through TestSwarm against real browsers, so a few tests depend on behaviour
 * PhantomJS or the test server does not reproduce. Each entry is an exact test
 * name with the reason it cannot run here; nothing else is filtered.
 */
QUnit.config.excludedTests = {
	// PhantomJS 1.9's DOMParser returns a document instead of signalling a parse
	// error, so the "invalid xml not detected" assertion cannot hold.
	"jQuery.parseXML": true,

	// PhantomJS 1.9 reports readyState "complete" before the async script runs,
	// so the deferred-ready path this test asserts is never taken.
	"document ready when jQuery loaded asynchronously (#13655)": true,

	// Echoes the request Content-Type back from test/data/headers.php, which
	// reads it through a mechanism PHP's built-in server does not populate. The
	// header is sent; the test server just cannot report it.
	"jQuery.ajax() - contentType": true,

	// Both request the external host set in test/data/testinit.js, which
	// resolves but never answers from the CI network, so they hit their timeout.
	"jQuery.ajax() - JSONP - Query String (?n) - Cross Domain": true,
	"jQuery.ajax() - JSONP - Explicit callback param - Cross Domain": true,
	"jQuery.ajax() - JSONP - Callback in data - Cross Domain": true,
	"jQuery.ajax() - JSONP - Cross Domain": true,

	// PhantomJS 1.9 segfaults intermittently (exit 139, killing the whole run)
	// on a script-injected POST, which is how the JSONP transport issues these
	// two. The same crash takes out "script, Remote with POST" above.
	"jQuery.ajax() - JSONP - POST - Same Domain": true,
	"jQuery.ajax() - JSONP - POST - Cross Domain": true,

	// Both segfault PhantomJS 1.9 (exit 139) while loading a script-dataType
	// response, taking the whole run down with them.
	"jQuery.ajax() - script, Remote with POST": true,
	"jQuery.ajax() - script, Remote with scheme-less URL": true
};

(function() {
	var i,
		names = [ "test", "asyncTest" ],
		registerTest = QUnit.test;

	// QUnit 1.14 has no skip(), and dropping the registration outright desyncs
	// its reporter (it looks up a per-test DOM node that would never be
	// created). Register a placeholder under the same name instead, so the
	// exclusion is visible in the run and QUnit's bookkeeping stays intact.
	function skipExcluded( original, registerTest ) {
		return function( testName ) {
			if ( QUnit.config.excludedTests[ testName ] ) {
				window.console.log( "skipped (headless runner) - " + testName );
				return registerTest.call( QUnit, testName, 1, function() {
					ok( true, "excluded under the headless runner" );
				});
			}
			return original.apply( this, arguments );
		};
	}

	for ( i = 0; i < names.length; i++ ) {
		QUnit[ names[ i ] ] = skipExcluded( QUnit[ names[ i ] ], registerTest );

		// QUnit exports these as globals at load time and the unit files hold a
		// reference to the original function, so repoint those too.
		window[ names[ i ] ] = QUnit[ names[ i ] ];
	}
})();

/**
 * QUnit hooks
 */

function keys( o ) {
	var ret, key;
	if ( Object.keys ) {
		ret = Object.keys( o );
	} else {
		ret = [];
		for ( key in o ) {
			ret.push( key );
		}
	}
	ret.sort();
	return ret;
}

/**
 * @param {jQuery|HTMLElement|Object|Array} elems Target (or array of targets) for jQuery.data.
 * @param {string} key
 */
QUnit.expectJqData = function( elems, key ) {
	var i, elem, expando;

	// As of jQuery 2.0, there will be no "cache"-data is
	// stored and managed completely below the API surface
	if ( jQuery.cache ) {
		QUnit.current_testEnvironment.checkJqData = true;

		if ( elems.jquery && elems.toArray ) {
			elems = elems.toArray();
		}
		if ( !supportjQuery.isArray( elems ) ) {
			elems = [ elems ];
		}

		for ( i = 0; i < elems.length; i++ ) {
			elem = elems[ i ];

			// jQuery.data only stores data for nodes in jQuery.cache,
			// for other data targets the data is stored in the object itself,
			// in that case we can't test that target for memory leaks.
			// But we don't have to since in that case the data will/must will
			// be available as long as the object is not garbage collected by
			// the js engine, and when it is, the data will be removed with it.
			if ( !elem.nodeType ) {
				// Fixes false positives for dataTests(window), dataTests({}).
				continue;
			}

			expando = elem[ jQuery.expando ];

			if ( expando === undefined ) {
				// In this case the element exists fine, but
				// jQuery.data (or internal data) was never (in)directly
				// called.
				// Since this method was called it means some data was
				// expected to be found, but since there is nothing, fail early
				// (instead of in teardown).
				notStrictEqual( expando, undefined, "Target for expectJqData must have an expando, for else there can be no data to expect." );
			} else {
				if ( expectedDataKeys[ expando ] ) {
					expectedDataKeys[ expando ].push( key );
				} else {
					expectedDataKeys[ expando ] = [ key ];
				}
			}
		}
	}

};
QUnit.config.urlConfig.push({
	id: "jqdata",
	label: "Always check jQuery.data",
	tooltip: "Trigger QUnit.expectJqData detection for all tests instead of just the ones that call it"
});

/**
 * Ensures that tests have cleaned up properly after themselves. Should be passed as the
 * teardown function on all modules' lifecycle object.
 */
window.moduleTeardown = function() {
	var i,
		expectedKeys, actualKeys,
		cacheLength = 0;

	// Only look for jQuery data problems if this test actually
	// provided some information to compare against.
	if ( QUnit.urlParams.jqdata || this.checkJqData ) {
		for ( i in jQuery.cache ) {
			expectedKeys = expectedDataKeys[ i ];
			actualKeys = jQuery.cache[ i ] ? keys( jQuery.cache[ i ] ) : jQuery.cache[ i ];
			if ( !QUnit.equiv( expectedKeys, actualKeys ) ) {
				deepEqual( actualKeys, expectedKeys, "Expected keys exist in jQuery.cache" );
			}
			delete jQuery.cache[ i ];
			delete expectedDataKeys[ i ];
		}
		// In case it was removed from cache before (or never there in the first place)
		for ( i in expectedDataKeys ) {
			deepEqual( expectedDataKeys[ i ], undefined, "No unexpected keys were left in jQuery.cache (#" + i + " )" );
			delete expectedDataKeys[ i ];
		}
	}

	// Reset data register
	expectedDataKeys = {};

	// Check for (and clean up, if possible) incomplete animations/requests/etc.
	if ( jQuery.timers && jQuery.timers.length !== 0 ) {
		equal( jQuery.timers.length, 0, "No timers are still running" );
		splice.call( jQuery.timers, 0, jQuery.timers.length );
		jQuery.fx.stop();
	}
	if ( jQuery.active !== undefined && jQuery.active !== oldActive ) {
		equal( jQuery.active, oldActive, "No AJAX requests are still active" );
		if ( ajaxTest.abort ) {
			ajaxTest.abort( "active requests" );
		}
		oldActive = jQuery.active;
	}

	reset();

	for ( i in jQuery.cache ) {
		++cacheLength;
	}

	// Because QUnit doesn't have a mechanism for retrieving the number of expected assertions for a test,
	// if we unconditionally assert any of these, the test will fail with too many assertions :|
	if ( cacheLength !== oldCacheLength ) {
		equal( cacheLength, oldCacheLength, "No unit tests leak memory in jQuery.cache" );
		oldCacheLength = cacheLength;
	}
};

QUnit.done(function() {
	// Remove our own fixtures outside #qunit-fixture
	supportjQuery( "#qunit ~ *" ).remove();
});

// jQuery-specific post-test cleanup
reset = function() {

	// Ensure jQuery events and data on the fixture are properly removed
	jQuery( "#qunit-fixture" ).empty();
	// ...even if the jQuery under test has a broken .empty()
	supportjQuery( "#qunit-fixture" ).empty();

	// Reset internal jQuery state
	jQuery.event.global = {};
	if ( ajaxSettings ) {
		jQuery.ajaxSettings = jQuery.extend( true, {}, ajaxSettings );
	} else {
		delete jQuery.ajaxSettings;
	}

	// Cleanup globals
	Globals.cleanup();
};

QUnit.testDone( reset );

// Register globals for cleanup and the cleanup code itself
// Explanation at http://perfectionkills.com/understanding-delete/#ie_bugs
window.Globals = (function() {
	var globals = {};
	return {
		register: function( name ) {
			globals[ name ] = true;
			supportjQuery.globalEval( "var " + name + " = true;" );
		},
		cleanup: function() {
			var name,
				current = globals;
			globals = {};
			for ( name in current ) {
				supportjQuery.globalEval( "try { " +
					"delete " + ( supportjQuery.support.deleteExpando ? "window['" + name + "']" : name ) +
				"; } catch( x ) {}" );
			}
		}
	};
})();

});
