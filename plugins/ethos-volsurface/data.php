<?php
/**
 * Volatility surface: Deribit options book, Black-Scholes implied volatility, 5-minute refresh.
 *
 * Source: Deribit public API v2, get_book_summary_by_currency (one request returns every live option
 * of a currency with best bid, best ask, mark IV and the underlying forward of its expiry). No API key:
 * this is public market data.
 *
 * For each option the mid price (best bid + best ask) / 2 is converted to an implied volatility with the
 * Black-Scholes formula on the expiry's forward (Black 1976, zero rate, as Deribit itself prices). The same
 * is done for the bid and the ask, and the delta is taken from the mid volatility. Deribit's own mark IV is
 * kept beside ours as a check, never used in place of it.
 *
 * Storage: one option per currency (ethos_vol_data_<coin>, not autoloaded). Refreshed every 5 minutes by
 * WP-Cron (driven by the server cron), and on request when the stored book is older than 5 minutes, at
 * most once per lock window, so visitors cannot make the server call Deribit more often than that.
 */
defined( 'ABSPATH' ) || exit;

const ETHOS_VOL_VERSION = '0.1.0';
const ETHOS_VOL_API     = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency';
const ETHOS_VOL_TTL     = 300;  // seconds a stored book counts as current
const ETHOS_VOL_LOCK    = 60;   // seconds one refresh may hold the lock
// coin => [Deribit currency parameter, instrument prefix, settlement]. SOL options are USDC-settled (linear).
const ETHOS_VOL_COINS = array(
    'BTC' => array( 'BTC', 'BTC', 'inverse' ),
    'ETH' => array( 'ETH', 'ETH', 'inverse' ),
    'SOL' => array( 'USDC', 'SOL_USDC', 'linear' ),
);
const ETHOS_VOL_FIELDS = array( 'expiry', 'strike', 'type', 'bid', 'ask', 'iv_bid', 'iv_mid', 'iv_ask', 'mark_iv', 'delta', 'oi' );

/* ---------- Black-Scholes (Black 1976 on the forward, r = 0) ---------- */

/** Complementary error function, fractional error below 1.2e-7 everywhere (Numerical Recipes erfcc). */
function ethos_vol_erfc( $x ) {
    $z = abs( $x );
    $t = 1 / ( 1 + 0.5 * $z );
    $r = $t * exp( -$z * $z - 1.26551223 + $t * ( 1.00002368 + $t * ( 0.37409196 + $t * ( 0.09678418 + $t * ( -0.18628806 + $t * ( 0.27886807 + $t * ( -1.13520398 + $t * ( 1.48851587 + $t * ( -0.82215223 + $t * 0.17087277 ) ) ) ) ) ) ) ) );
    return $x >= 0 ? $r : 2 - $r;
}

function ethos_vol_ncdf( $x ) {
    return 0.5 * ethos_vol_erfc( -$x / M_SQRT2 );
}

/** Undiscounted Black price in quote units (USD). $call is bool. */
function ethos_vol_price( $f, $k, $t, $sigma, $call ) {
    $sd = $sigma * sqrt( $t );
    $d1 = ( log( $f / $k ) + 0.5 * $sd * $sd ) / $sd;
    $d2 = $d1 - $sd;
    return $call ? $f * ethos_vol_ncdf( $d1 ) - $k * ethos_vol_ncdf( $d2 ) : $k * ethos_vol_ncdf( -$d2 ) - $f * ethos_vol_ncdf( -$d1 );
}

/** Forward delta: N(d1) for a call, N(d1) - 1 for a put. */
function ethos_vol_delta( $f, $k, $t, $sigma, $call ) {
    $sd = $sigma * sqrt( $t );
    $n  = ethos_vol_ncdf( ( log( $f / $k ) + 0.5 * $sd * $sd ) / $sd );
    return $call ? $n : $n - 1;
}

/**
 * Implied volatility of a USD price, or null when the price has no solution (at or below intrinsic value,
 * or at or above the no-arbitrage ceiling). Bisection on [0.5%, 1000%], to 1e-6 volatility.
 */
function ethos_vol_implied( $price, $f, $k, $t, $call ) {
    if ( ! ( $price > 0 ) || ! ( $t > 0 ) || ! ( $f > 0 ) || ! ( $k > 0 ) ) { return null; }
    $intrinsic = $call ? max( $f - $k, 0 ) : max( $k - $f, 0 );
    $ceiling   = $call ? $f : $k;
    if ( $price <= $intrinsic * ( 1 + 1e-9 ) || $price >= $ceiling ) { return null; }
    $lo = 0.005; $hi = 10.0;
    if ( ethos_vol_price( $f, $k, $t, $lo, $call ) > $price || ethos_vol_price( $f, $k, $t, $hi, $call ) < $price ) { return null; }
    for ( $i = 0; $i < 60 && $hi - $lo > 1e-6; $i++ ) {
        $mid = 0.5 * ( $lo + $hi );
        if ( ethos_vol_price( $f, $k, $t, $mid, $call ) > $price ) { $hi = $mid; } else { $lo = $mid; }
    }
    return 0.5 * ( $lo + $hi );
}

/* ---------- Normalising one Deribit book ---------- */

/** "26MAR27" -> Unix seconds of 08:00 UTC that day (Deribit's expiry time), or null. */
function ethos_vol_expiry_ts( $code ) {
    if ( ! preg_match( '/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})$/D', $code, $m ) ) { return null; }
    $month = 1 + array_search( $m[2], array( 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC' ), true );
    $year  = 2000 + (int) $m[3];
    if ( ! checkdate( $month, (int) $m[1], $year ) ) { return null; }
    return gmmktime( 8, 0, 0, $month, (int) $m[1], $year );
}

function ethos_vol_num( $v ) {
    return ( is_int( $v ) || is_float( $v ) ) && is_finite( (float) $v ) ? (float) $v : null;
}

function ethos_vol_round( $v, $digits ) {
    return null === $v ? null : round( $v, $digits );
}

/**
 * Pure: Deribit book summary rows -> compact surface payload. Exercised without WordPress by the harness.
 * $now is Unix seconds.
 */
function ethos_vol_normalize( $coin, array $rows, $now ) {
    if ( ! isset( ETHOS_VOL_COINS[ $coin ] ) ) { throw new InvalidArgumentException( 'Unknown coin' ); }
    [, $prefix, $settle] = ETHOS_VOL_COINS[ $coin ];
    $re = '/^' . preg_quote( $prefix, '/' ) . '-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:d\d+)?)-([CP])$/D';
    $expiries = array(); $out = array(); $index = null; $source_ms = 0; $seen = 0; $quoted = 0; $diffs = array();
    foreach ( $rows as $r ) {
        if ( ! is_array( $r ) || ! is_string( $r['instrument_name'] ?? null ) || ! preg_match( $re, $r['instrument_name'], $m ) ) { continue; }
        $ts = ethos_vol_expiry_ts( $m[1] );
        $f  = ethos_vol_num( $r['underlying_price'] ?? null );
        if ( null === $ts || null === $f || $f <= 0 ) { continue; }
        $t = ( $ts - $now ) / ( 365 * DAY_IN_SECONDS );
        if ( $t <= 1 / ( 365 * 24 ) ) { continue; } // expiring within the hour: no meaningful volatility
        $seen++;
        $k    = (float) str_replace( 'd', '.', $m[2] );
        $call = 'C' === $m[3];
        $bid  = ethos_vol_num( $r['bid_price'] ?? null );
        $ask  = ethos_vol_num( $r['ask_price'] ?? null );
        $mark = ethos_vol_num( $r['mark_iv'] ?? null );
        $oi   = ethos_vol_num( $r['open_interest'] ?? null );
        $bid  = null !== $bid && $bid > 0 ? $bid : null;
        $ask  = null !== $ask && $ask > 0 ? $ask : null;
        if ( null !== $bid && null !== $ask && $ask < $bid ) { $bid = $ask = null; } // crossed book: ignore
        $index = $index ?? ethos_vol_num( $r['estimated_delivery_price'] ?? null );
        $source_ms = max( $source_ms, (int) ( $r['creation_timestamp'] ?? 0 ) );
        // Inverse options are quoted in coin: the USD premium is coin price x the expiry's forward.
        $usd   = 'inverse' === $settle ? $f : 1.0;
        $iv    = static fn( $p ) => null === $p ? null : ethos_vol_implied( $p * $usd, $f, $k, $t, $call );
        $iv_bid = $iv( $bid ); $iv_ask = $iv( $ask );
        $iv_mid = null !== $bid && null !== $ask ? $iv( 0.5 * ( $bid + $ask ) ) : null;
        $sigma  = $iv_mid ?? ( null !== $mark && $mark > 0 ? $mark / 100 : null );
        if ( null === $sigma ) { continue; }
        // The check compares out-of-the-money options only: deep in-the-money prices are nearly all
        // intrinsic value, so any volatility fits them and the comparison would say nothing.
        if ( null !== $iv_mid ) { $quoted++; if ( null !== $mark && $call === ( $k >= $f ) ) { $diffs[] = abs( 100 * $iv_mid - $mark ); } }
        if ( ! isset( $expiries[ $m[1] ] ) ) { $expiries[ $m[1] ] = array( 'code' => $m[1], 'ts' => $ts, 'forward' => $f ); }
        $out[] = array( $m[1], $k, $call ? 'C' : 'P',
            $bid, $ask,
            ethos_vol_round( null === $iv_bid ? null : 100 * $iv_bid, 2 ),
            ethos_vol_round( null === $iv_mid ? null : 100 * $iv_mid, 2 ),
            ethos_vol_round( null === $iv_ask ? null : 100 * $iv_ask, 2 ),
            ethos_vol_round( $mark, 2 ),
            round( ethos_vol_delta( $f, $k, $t, $sigma, $call ), 4 ),
            null === $oi ? null : round( $oi, 2 ) );
    }
    uasort( $expiries, static fn( $a, $b ) => $a['ts'] <=> $b['ts'] );
    $order = array_flip( array_keys( $expiries ) );
    foreach ( $out as &$row ) { $row[0] = $order[ $row[0] ]; } unset( $row );
    usort( $out, static fn( $a, $b ) => array( $a[0], $a[1], $a[2] ) <=> array( $b[0], $b[1], $b[2] ) );
    sort( $diffs );
    $median = $diffs ? ( count( $diffs ) % 2 ? $diffs[ intdiv( count( $diffs ), 2 ) ] : 0.5 * ( $diffs[ count( $diffs ) / 2 - 1 ] + $diffs[ count( $diffs ) / 2 ] ) ) : null;
    return array(
        'version'   => 1,
        'coin'      => $coin,
        'settle'    => $settle,
        'quote'     => 'inverse' === $settle ? $coin : 'USDC',
        'fetched'   => gmdate( 'c', $now ),
        'source_ms' => $source_ms ?: null,
        'index'     => $index,
        'expiries'  => array_values( array_map( static fn( $e ) => array( 'code' => $e['code'], 'ts' => $e['ts'], 'forward' => round( $e['forward'], 4 ) ), $expiries ) ),
        'fields'    => ETHOS_VOL_FIELDS,
        'rows'      => $out,
        'counts'    => array( 'instruments' => $seen, 'two_sided' => $quoted, 'rows' => count( $out ) ),
        'check'     => array( 'median_abs_diff_vs_mark' => null === $median ? null : round( $median, 2 ), 'compared' => count( $diffs ) ),
    );
}

/* ---------- Fetch, store, lock ---------- */

function ethos_vol_fetch( $coin ) {
    [$currency] = ETHOS_VOL_COINS[ $coin ];
    $url      = add_query_arg( array( 'currency' => $currency, 'kind' => 'option' ), ETHOS_VOL_API );
    $response = wp_remote_get( $url, array( 'timeout' => 12, 'redirection' => 0, 'limit_response_size' => 12000000, 'headers' => array( 'Accept' => 'application/json' ), 'user-agent' => 'EthosResearch-VolSurface/' . ETHOS_VOL_VERSION ) );
    if ( is_wp_error( $response ) ) { throw new RuntimeException( 'Deribit request failed: ' . $response->get_error_message() ); }
    if ( 200 !== wp_remote_retrieve_response_code( $response ) ) { throw new RuntimeException( 'Deribit HTTP ' . wp_remote_retrieve_response_code( $response ) ); }
    $body = json_decode( wp_remote_retrieve_body( $response ), true, 64, JSON_THROW_ON_ERROR );
    if ( ! is_array( $body['result'] ?? null ) ) { throw new RuntimeException( 'Deribit response has no result' ); }
    return $body['result'];
}

function ethos_vol_get( $coin ) {
    $data = get_option( 'ethos_vol_data_' . strtolower( $coin ) );
    return is_array( $data ) && 1 === ( $data['version'] ?? null ) ? $data : null;
}

function ethos_vol_age( $data ) {
    return $data ? max( 0, time() - (int) strtotime( $data['fetched'] ) ) : PHP_INT_MAX;
}

/** One refresh per coin at a time; a lock older than ETHOS_VOL_LOCK is taken over. */
function ethos_vol_lock( $coin ) {
    $name = 'ethos_vol_lock_' . strtolower( $coin );
    if ( add_option( $name, time(), '', false ) ) { return $name; }
    $at = (int) get_option( $name );
    if ( time() - $at < ETHOS_VOL_LOCK ) { return null; }
    global $wpdb;
    $taken = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", (string) time(), $name, (string) $at ) );
    wp_cache_delete( $name, 'options' );
    return 1 === $taken ? $name : null;
}

/** Fetch and store one coin. Returns the new payload, or null if another process holds the lock. */
function ethos_vol_refresh( $coin ) {
    $lock = ethos_vol_lock( $coin );
    if ( ! $lock ) { return null; }
    try {
        $data = ethos_vol_normalize( $coin, ethos_vol_fetch( $coin ), time() );
        if ( $data['counts']['two_sided'] < 20 || count( $data['expiries'] ) < 2 ) { throw new RuntimeException( 'Deribit book too thin to build a surface' ); }
        update_option( 'ethos_vol_data_' . strtolower( $coin ), $data, false );
        delete_option( 'ethos_vol_error_' . strtolower( $coin ) );
        ethos_vol_purge_cache();
        return $data;
    } catch ( Throwable $e ) {
        update_option( 'ethos_vol_error_' . strtolower( $coin ), array( 'at' => gmdate( 'c' ), 'message' => substr( $e->getMessage(), 0, 300 ) ), false );
        error_log( 'Ethos vol surface ' . $coin . ': ' . $e->getMessage() );
        throw $e;
    } finally {
        delete_option( $lock );
    }
}

/** Drop LiteSpeed's copies of the REST responses (tag ethos_vol) after each new book. */
function ethos_vol_purge_cache() {
    do_action( 'litespeed_purge', 'ethos_vol' );
}

/* ---------- Schedule: every 5 minutes ---------- */

add_filter( 'cron_schedules', static function ( $s ) {
    $s['ethos_vol_5min'] = array( 'interval' => ETHOS_VOL_TTL, 'display' => 'Every 5 minutes (Ethos vol surface)' );
    return $s;
} );
add_action( 'init', static function () {
    if ( wp_get_schedule( 'ethos_vol_tick' ) !== 'ethos_vol_5min' ) {
        wp_clear_scheduled_hook( 'ethos_vol_tick' );
        wp_schedule_event( time() + 30, 'ethos_vol_5min', 'ethos_vol_tick' );
    }
} );
add_action( 'ethos_vol_tick', 'ethos_vol_tick' );

/** Refresh every coin whose book is older than 4 minutes (so a 5-minute cron never skips a beat). */
function ethos_vol_tick() {
    foreach ( array_keys( ETHOS_VOL_COINS ) as $coin ) {
        if ( ethos_vol_age( ethos_vol_get( $coin ) ) < ETHOS_VOL_TTL - 60 ) { continue; }
        try { ethos_vol_refresh( $coin ); } catch ( Throwable $e ) { continue; } // logged; the last good book stays
    }
}

register_activation_hook( __DIR__ . '/ethos-volsurface.php', static function () {
    if ( ! wp_next_scheduled( 'ethos_vol_tick' ) ) { wp_schedule_event( time() + 10, 'ethos_vol_5min', 'ethos_vol_tick' ); }
} );
register_deactivation_hook( __DIR__ . '/ethos-volsurface.php', static function () {
    wp_clear_scheduled_hook( 'ethos_vol_tick' );
} );
