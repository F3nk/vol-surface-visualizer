<?php
/**
 * Local checks for plugins/ethos-volsurface without WordPress.
 *
 *   php tools/vol_harness.php selftest              Black-Scholes and parsing unit checks
 *   php tools/vol_harness.php book <file> <COIN>    normalise a saved Deribit response and compare with mark IV
 *   php tools/vol_harness.php json <file> <COIN>    print the normalised payload
 *   php tools/vol_harness.php rest <COIN>           run the real REST callback (live Deribit via curl, options in a local JSON file)
 *   php tools/vol_harness.php shortcode             print the page HTML
 *
 * Fixtures: curl "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option"
 * (SOL uses currency=USDC). The bundled PHP has no OpenSSL, so HTTP goes through curl.exe.
 */
define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
$GLOBALS['vol_dir'] = getenv( 'TEMP' ) . '/ethos-vol-harness';
is_dir( $GLOBALS['vol_dir'] ) || mkdir( $GLOBALS['vol_dir'], 0777, true );
$GLOBALS['vol_routes'] = array(); $GLOBALS['vol_shortcodes'] = array(); $GLOBALS['vol_hooks'] = array(); $GLOBALS['vol_actions'] = array();
class WP_Error { public $code, $message, $data; function __construct( $c = '', $m = '', $d = null ) { $this->code = $c; $this->message = $m; $this->data = $d; } function get_error_message() { return $this->message; } }
class WP_REST_Response { public $data, $status = 200, $headers = array(); function __construct( $d = null, $s = 200 ) { $this->data = $d; $this->status = $s; } function header( $k, $v ) { $this->headers[ $k ] = $v; } }
class WP_REST_Server { const READABLE = 'GET'; }
class WP_REST_Request implements ArrayAccess {
    private $p; function __construct( $p ) { $this->p = $p; }
    function offsetExists( $o ): bool { return isset( $this->p[ $o ] ); } function offsetGet( $o ): mixed { return $this->p[ $o ] ?? null; }
    function offsetSet( $o, $v ): void { $this->p[ $o ] = $v; } function offsetUnset( $o ): void { unset( $this->p[ $o ] ); }
}
function add_filter( ...$a ) {}
function add_action( $hook, $cb ) { $GLOBALS['vol_hooks'][ $hook ][] = $cb; }
function do_action( $hook, ...$args ) { $GLOBALS['vol_actions'][] = $hook . ( $args ? ':' . implode( ',', $args ) : '' ); }
function register_activation_hook( ...$a ) {}
function register_deactivation_hook( ...$a ) {}
function register_rest_route( $ns, $route, $args ) { $GLOBALS['vol_routes'][ $route ] = $args; }
function add_shortcode( $n, $cb ) { $GLOBALS['vol_shortcodes'][ $n ] = $cb; }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function rest_ensure_response( $d ) { return $d instanceof WP_REST_Response ? $d : new WP_REST_Response( $d ); }
function __( $t, ...$a ) { return $t; }
function esc_html__( $t, ...$a ) { return htmlspecialchars( $t, ENT_QUOTES, 'UTF-8' ); }
function esc_attr__( $t, ...$a ) { return esc_html__( $t ); }
function esc_html_e( $t, ...$a ) { echo esc_html__( $t ); }
function esc_attr_e( $t, ...$a ) { echo esc_html__( $t ); }
function esc_html( $t ) { return esc_html__( (string) $t ); }
function esc_attr( $t ) { return esc_html__( (string) $t ); }
function esc_url( $t ) { return esc_html__( (string) $t ); }
function selected( $a, $b ) { if ( (string) $a === (string) $b ) { echo ' selected'; } }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); }
function wp_json_encode( $v, $f = 0 ) { return json_encode( $v, $f | JSON_UNESCAPED_SLASHES ); }
function home_url( $p = '' ) { return $p; }
function rest_url( $p = '' ) { return '/vol-api/surface'; }
function plugins_url( $p = '', ...$a ) { return '/plugins/ethos-volsurface/' . $p; }
function wp_unique_id( $p = '' ) { static $i = 0; return $p . ++$i; }
function wp_enqueue_style( ...$a ) {}
function wp_enqueue_script( ...$a ) {}
function error_log_stub( $m ) { fwrite( STDERR, $m . "\n" ); }
function add_query_arg( $args, $url ) { return $url . '?' . http_build_query( $args ); }
function vol_options() { $f = $GLOBALS['vol_dir'] . '/options.json'; return is_file( $f ) ? json_decode( file_get_contents( $f ), true ) : array(); }
function vol_save( $o ) { file_put_contents( $GLOBALS['vol_dir'] . '/options.json', json_encode( $o ) ); }
function get_option( $k, $d = false ) { $o = vol_options(); return array_key_exists( $k, $o ) ? $o[ $k ] : $d; }
function add_option( $k, $v, ...$a ) { $o = vol_options(); if ( array_key_exists( $k, $o ) ) { return false; } $o[ $k ] = $v; vol_save( $o ); return true; }
function update_option( $k, $v, ...$a ) { $o = vol_options(); $o[ $k ] = $v; vol_save( $o ); return true; }
function delete_option( $k ) { $o = vol_options(); unset( $o[ $k ] ); vol_save( $o ); return true; }
function wp_cache_delete( ...$a ) {}
class Vol_Wpdb { public $options = 'wp_options'; function prepare( $q, ...$a ) { return array( $q, $a ); } function query( $p ) { [, $a] = $p; $o = vol_options(); if ( (string) ( $o[ $a[1] ] ?? '' ) !== $a[2] ) { return 0; } $o[ $a[1] ] = (int) $a[0]; vol_save( $o ); return 1; } }
$GLOBALS['wpdb'] = new Vol_Wpdb();
function wp_remote_get( $url, $args = array() ) {
    $p = proc_open( array( 'curl', '-s', '--max-time', '20', '-w', '\n%{http_code}', $url ), array( 1 => array( 'pipe', 'w' ), 2 => array( 'pipe', 'w' ) ), $pipes );
    $out = stream_get_contents( $pipes[1] ); proc_close( $p );
    $code = (int) substr( $out, strrpos( $out, "\n" ) + 1 );
    return $code ? array( 'code' => $code, 'body' => substr( $out, 0, strrpos( $out, "\n" ) ) ) : new WP_Error( 'http', 'curl failed' );
}
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
require dirname( __DIR__ ) . '/plugins/ethos-volsurface/ethos-volsurface.php';
foreach ( $GLOBALS['vol_hooks']['rest_api_init'] ?? array() as $cb ) { $cb(); }

if ( 'shortcode' === ( $argv[1] ?? '' ) ) { echo $GLOBALS['vol_shortcodes']['ethos_volsurface'](); exit; }
if ( 'rest' === ( $argv[1] ?? '' ) ) {
    $coin = strtoupper( $argv[2] ?? 'BTC' );
    if ( ! isset( ETHOS_VOL_COINS[ $coin ] ) ) { echo json_encode( array( 'code' => 'rest_invalid_param' ) ); exit( 2 ); }
    $res = $GLOBALS['vol_routes']['/surface']['callback']( new WP_REST_Request( array( 'coin' => $coin ) ) );
    if ( $res instanceof WP_Error ) { fwrite( STDERR, "status {$res->data['status']}\n" ); echo json_encode( array( 'code' => $res->code, 'message' => $res->message ) ); exit( 3 ); }
    fwrite( STDERR, 'headers ' . json_encode( $res->headers ) . ' actions ' . json_encode( $GLOBALS['vol_actions'] ) . "\n" );
    echo json_encode( $res->data );
    exit;
}

$fail = 0;
function check( $label, $ok ) { global $fail; echo ( $ok ? 'ok   ' : 'FAIL ' ) . $label . "\n"; if ( ! $ok ) { $fail++; } }

$mode = $argv[1] ?? 'selftest';
if ( 'selftest' === $mode ) {
    // Black 76, F = K = 100, T = 1, sigma = 20%: call = 100 (2 N(0.1) - 1) = 7.96557
    $c = ethos_vol_price( 100, 100, 1, 0.2, true );
    check( 'ATM call price 7.9656 (got ' . round( $c, 5 ) . ')', abs( $c - 7.96557 ) < 1e-4 );
    $p = ethos_vol_price( 100, 120, 0.5, 0.6, false ); $cc = ethos_vol_price( 100, 120, 0.5, 0.6, true );
    check( 'put-call parity C - P = F - K', abs( ( $cc - $p ) - ( 100 - 120 ) ) < 1e-6 );
    foreach ( array( array( 100, 80, 0.05, 0.9, true ), array( 100, 150, 2, 0.45, false ), array( 60000, 90000, 0.3, 0.55, true ), array( 70, 50, 0.02, 1.4, false ) ) as [$f, $k, $t, $s, $call] ) {
        $iv = ethos_vol_implied( ethos_vol_price( $f, $k, $t, $s, $call ), $f, $k, $t, $call );
        check( "implied vol round trip F=$f K=$k T=$t sigma=$s", null !== $iv && abs( $iv - $s ) < 1e-5 );
    }
    check( 'no IV below intrinsic', null === ethos_vol_implied( 19.9, 100, 80, 0.5, true ) );
    check( 'no IV above the call ceiling', null === ethos_vol_implied( 100, 100, 80, 0.5, true ) );
    check( 'call delta ATM ~ 0.54', abs( ethos_vol_delta( 100, 100, 1, 0.2, true ) - 0.5398 ) < 1e-3 );
    check( 'put delta = call delta - 1', abs( ethos_vol_delta( 100, 90, 1, 0.5, false ) - ( ethos_vol_delta( 100, 90, 1, 0.5, true ) - 1 ) ) < 1e-12 );
    check( 'expiry 26MAR27 08:00 UTC', gmdate( 'c', ethos_vol_expiry_ts( '26MAR27' ) ) === '2027-03-26T08:00:00+00:00' );
    check( 'expiry 4DEC26 parsed', gmdate( 'Y-m-d H', ethos_vol_expiry_ts( '4DEC26' ) ) === '2026-12-04 08' );
    check( 'invalid expiry rejected', null === ethos_vol_expiry_ts( '31FEB27' ) && null === ethos_vol_expiry_ts( 'XX' ) );
    check( 'erfc symmetry', abs( ethos_vol_erfc( -0.7 ) + ethos_vol_erfc( 0.7 ) - 2 ) < 1e-12 );
    // A synthetic SOL row with a decimal strike and an inverse BTC row
    $now = gmmktime( 8, 0, 0, 11, 21, 2026 );
    $sol = ethos_vol_normalize( 'SOL', array(
        array( 'instrument_name' => 'SOL_USDC-25DEC26-72d5-C', 'underlying_price' => 70.0, 'bid_price' => 4.0, 'ask_price' => 4.4, 'mark_iv' => 80.0, 'open_interest' => 10, 'estimated_delivery_price' => 70.1, 'creation_timestamp' => 1 ),
        array( 'instrument_name' => 'BTC-25DEC26-60000-C', 'underlying_price' => 60000, 'bid_price' => 0.05, 'ask_price' => 0.06 ),
    ), $now );
    check( 'SOL decimal strike 72.5 and other coins ignored', 1 === count( $sol['rows'] ) && 72.5 === $sol['rows'][0][1] );
    check( 'SOL linear: mid 4.2 USDC solves', null !== $sol['rows'][0][6] && $sol['rows'][0][6] > 30 && $sol['rows'][0][6] < 200 );
    $btc = ethos_vol_normalize( 'BTC', array(
        array( 'instrument_name' => 'BTC-25DEC26-60000-C', 'underlying_price' => 60000.0, 'bid_price' => 0.0, 'ask_price' => 0.06, 'mark_iv' => 50.0 ),
        array( 'instrument_name' => 'BTC-25DEC26-60000-P', 'underlying_price' => 60000.0, 'bid_price' => 0.07, 'ask_price' => 0.06, 'mark_iv' => 50.0 ),
    ), $now );
    check( 'one-sided and crossed quotes give no mid IV, mark IV kept', 2 === count( $btc['rows'] ) && null === $btc['rows'][0][6] && null === $btc['rows'][1][6] && 0 === $btc['counts']['two_sided'] );
    exit( $fail ? 1 : 0 );
}

$file = $argv[2] ?? ''; $coin = $argv[3] ?? 'BTC';
$body = json_decode( file_get_contents( $file ), true );
$rows = $body['result'] ?? array();
$now  = (int) floor( max( array_map( static fn( $r ) => (int) ( $r['creation_timestamp'] ?? 0 ), $rows ) ) / 1000 ) ?: time();
$t0   = microtime( true );
$data = ethos_vol_normalize( $coin, $rows, $now );
$ms   = round( 1000 * ( microtime( true ) - $t0 ) );
if ( 'json' === $mode ) { echo json_encode( $data ); exit; }

echo "$coin: {$data['counts']['instruments']} live options, {$data['counts']['two_sided']} two-sided, " . count( $data['expiries'] ) . " expiries, {$ms} ms\n";
echo 'index ' . $data['index'] . ', median |our mid IV - Deribit mark IV| = ' . $data['check']['median_abs_diff_vs_mark'] . " vol pts over {$data['check']['compared']} options\n";
$json = json_encode( $data );
echo 'payload ' . strlen( $json ) . ' bytes, gzip ' . strlen( gzencode( $json, 6 ) ) . "\n";
// Liquid out-of-the-money options (spread <= 10%), the ones the default surface uses, should sit very close
// to Deribit's mark. Deep in-the-money options are almost all intrinsic value, so their IV is ill-defined.
$f = array_flip( $data['fields'] ); $tight = array();
foreach ( $data['rows'] as $r ) {
    if ( null === $r[ $f['iv_mid'] ] || null === $r[ $f['mark_iv'] ] ) { continue; }
    if ( ( 'C' === $r[ $f['type'] ] ) !== ( $r[ $f['strike'] ] >= $data['expiries'][ $r[0] ]['forward'] ) ) { continue; }
    $mid = 0.5 * ( $r[ $f['bid'] ] + $r[ $f['ask'] ] );
    if ( ( $r[ $f['ask'] ] - $r[ $f['bid'] ] ) / $mid <= 0.1 ) { $tight[] = abs( $r[ $f['iv_mid'] ] - $r[ $f['mark_iv'] ] ); }
}
sort( $tight );
$med = $tight ? $tight[ intdiv( count( $tight ), 2 ) ] : null;
echo 'spread <= 10%: ' . count( $tight ) . ' options, median gap ' . $med . ', 90th pct ' . ( $tight ? $tight[ (int) floor( 0.9 * ( count( $tight ) - 1 ) ) ] : null ) . "\n";
check( 'liquid options within 1 vol pt of Deribit mark (median)', null !== $med && $med < 1.0 );
check( 'bid IV <= mid IV <= ask IV everywhere', (function () use ( $data, $f ) {
    foreach ( $data['rows'] as $r ) {
        foreach ( array( array( 'iv_bid', 'iv_mid' ), array( 'iv_mid', 'iv_ask' ) ) as [$a, $b] ) {
            if ( null !== $r[ $f[ $a ] ] && null !== $r[ $f[ $b ] ] && $r[ $f[ $a ] ] > $r[ $f[ $b ] ] + 0.011 ) { return false; }
        }
    }
    return true;
})() );
check( 'deltas within [-1, 1], calls positive, puts negative', (function () use ( $data, $f ) {
    foreach ( $data['rows'] as $r ) { $d = $r[ $f['delta'] ]; if ( $d < -1 || $d > 1 || ( 'C' === $r[ $f['type'] ] ) !== ( $d >= 0 ) ) { return false; } }
    return true;
})() );
exit( $fail ? 1 : 0 );
