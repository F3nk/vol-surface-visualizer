<?php
/**
 * Plugin Name: Ethos Vol Surface Visualizer
 * Description: Live implied-volatility surfaces for BTC, ETH and SOL options, computed with Black-Scholes from Deribit mid-market prices and refreshed every five minutes.
 * Version: 0.1.0
 * Requires at least: 6.6
 * Requires PHP: 8.1
 * License: GPL-2.0-or-later
 * Text Domain: ethos
 */

defined( 'ABSPATH' ) || exit;
require_once __DIR__ . '/data.php';

/* ---------- REST ---------- */

add_action( 'rest_api_init', static function () {
    register_rest_route( 'ethos-vol/v1', '/surface', array(
        'methods'             => WP_REST_Server::READABLE,
        'permission_callback' => '__return_true',
        'args'                => array( 'coin' => array( 'required' => true, 'type' => 'string', 'enum' => array_keys( ETHOS_VOL_COINS ) ) ),
        'callback'            => static function ( WP_REST_Request $request ) {
            $coin = $request['coin'];
            $data = ethos_vol_get( $coin );
            // Refresh on request when the stored book is older than 5 minutes. The lock lets one visitor
            // trigger it; everyone else gets the stored book until the new one is in.
            if ( ethos_vol_age( $data ) >= ETHOS_VOL_TTL ) {
                try { $data = ethos_vol_refresh( $coin ) ?? $data; } catch ( Throwable $e ) { /* logged; keep the last good book */ }
            }
            if ( ! $data ) {
                return new WP_Error( 'vol_unavailable', __( 'The Deribit options book could not be loaded. Please try again in a minute.', 'ethos' ), array( 'status' => 503 ) );
            }
            $age     = ethos_vol_age( $data );
            $failure = get_option( 'ethos_vol_error_' . strtolower( $coin ) );
            $data['age']    = $age;
            $data['ttl']    = ETHOS_VOL_TTL;
            $data['stale']  = $age > ETHOS_VOL_TTL + 120;
            $data['failed'] = is_array( $failure ) ? sanitize_text_field( $failure['at'] ?? '' ) : null;
            $max_age  = max( 15, min( ETHOS_VOL_TTL, ETHOS_VOL_TTL - $age ) );
            $response = rest_ensure_response( $data );
            $response->header( 'Cache-Control', 'public, max-age=' . (int) $max_age );
            // LiteSpeed ignores Cache-Control on REST and keeps its own TTL: tag the response so each refresh
            // purges it, and cap its life at the time left until the next refresh.
            do_action( 'litespeed_tag_add', 'ethos_vol' );
            do_action( 'litespeed_control_set_ttl', (int) $max_age );
            return $response;
        },
    ) );
} );

/* ---------- Client copy ---------- */

function ethos_vol_i18n() {
    return array(
        'loading'        => __( 'Loading the Deribit options book…', 'ethos' ),
        'unavailable'    => __( 'The Deribit options book could not be loaded. Please try again in a minute.', 'ethos' ),
        'updated'        => __( 'Deribit book at %1$s UTC (%2$s). Next update about %3$s UTC.', 'ethos' ),
        'justNow'        => __( 'just now', 'ethos' ),
        'minAgo'         => __( '%s min ago', 'ethos' ),
        'stale'          => __( 'Refresh overdue: showing the last good book from Deribit.', 'ethos' ),
        'noWebgl'        => __( 'Your browser cannot draw 3D charts here, so the surface is shown as a heatmap.', 'ethos' ),
        'empty'          => __( 'No options match these filters. Widen the expiry range or the maximum spread.', 'ethos' ),
        'chartFailed'    => __( 'The chart could not be drawn. The tables below still hold the data.', 'ethos' ),
        'delta'          => __( 'Delta', 'ethos' ),
        'strike'         => __( 'Strike', 'ethos' ),
        'moneyness'      => __( 'Strike / forward', 'ethos' ),
        'days'           => __( 'Days to expiry', 'ethos' ),
        'iv'             => __( 'Implied volatility (%)', 'ethos' ),
        'ivShort'        => __( 'IV', 'ethos' ),
        'atm'            => __( 'ATM', 'ethos' ),
        'call'           => __( 'call', 'ethos' ),
        'put'            => __( 'put', 'ethos' ),
        'callShort'      => __( 'Call', 'ethos' ),
        'putShort'       => __( 'Put', 'ethos' ),
        'forward'        => __( 'Forward', 'ethos' ),
        'midIv'          => __( 'Mid IV (bid–ask range)', 'ethos' ),
        'markIv'         => __( 'Deribit mark IV', 'ethos' ),
        'quotes'         => __( 'Quotes used', 'ethos' ),
        'expiry'         => __( 'Expiry', 'ethos' ),
        'type'           => __( 'Type', 'ethos' ),
        'bid'            => __( 'Bid', 'ethos' ),
        'ask'            => __( 'Ask', 'ethos' ),
        'bidIv'          => __( 'Bid IV', 'ethos' ),
        'askIv'          => __( 'Ask IV', 'ethos' ),
        'oi'             => __( 'Open interest', 'ethos' ),
        'atmIv'          => __( 'ATM IV', 'ethos' ),
        'rr25'           => __( '25Δ risk reversal', 'ethos' ),
        'fly25'          => __( '25Δ butterfly', 'ethos' ),
        'options'        => __( 'Options', 'ethos' ),
        'volPts'         => __( 'vol pts', 'ethos' ),
        'priceIn'        => __( 'Prices in %s', 'ethos' ),
        'noRows'         => __( 'No quotes for this expiry pass the filters.', 'ethos' ),
        'used'           => __( '%1$s of %2$s options have a two-sided quote', 'ethos' ),
        'checkMedian'    => __( 'Median gap to Deribit mark IV', 'ethos' ),
        'instruments'    => __( 'Live options', 'ethos' ),
        'twoSided'       => __( 'With bid and ask', 'ethos' ),
        'expiries'       => __( 'Expiries', 'ethos' ),
        'fetched'        => __( 'Fetched', 'ethos' ),
        'copied'         => __( 'View link copied.', 'ethos' ),
        'copyFailed'     => __( 'The link could not be copied automatically.', 'ethos' ),
        'aiCopied'       => __( 'Prompt copied. If the chat opens empty, paste it in.', 'ethos' ),
        'aiCopyFailed'   => __( 'The prompt could not be copied automatically. Open “See the prompt” and copy it from there.', 'ethos' ),
        'csvDone'        => __( 'CSV downloaded.', 'ethos' ),
        'expand'         => __( 'Expand chart', 'ethos' ),
        'collapse'       => __( 'Close expanded view', 'ethos' ),
        'rotateOn'       => __( 'Rotate chart', 'ethos' ),
        'rotateOff'      => __( 'Stop rotating', 'ethos' ),
        'reportBuilding' => __( 'Building your report…', 'ethos' ),
        'reportDone'     => __( 'Report downloaded.', 'ethos' ),
        'reportFailed'   => __( 'The report could not be built. Please try again.', 'ethos' ),
        'reportKicker'   => __( 'Ethos Research · Tools', 'ethos' ),
        'reportSelection' => __( 'Your selection', 'ethos' ),
        'reportSurface'  => __( 'Volatility surface', 'ethos' ),
        'reportSmile'    => __( 'Smile', 'ethos' ),
        'reportTerm'     => __( 'Term structure', 'ethos' ),
        'reportMethod'   => __( 'Method', 'ethos' ),
        'reportMethodText' => __( 'Implied volatility is solved from the mid-market price (best bid plus best ask, halved) with the Black-Scholes formula on each expiry’s forward at a zero rate, the convention Deribit uses. Options without both a bid and an ask, or with a spread wider than the chosen limit, are left out. The surface is interpolated linearly between quoted points along each expiry and never extrapolated. ATM IV is read at strike = forward; the 25-delta risk reversal is the 25-delta call IV minus the 25-delta put IV; the butterfly is their average minus ATM IV. 30-day values are interpolated between the expiries either side, ATM in total variance.', 'ethos' ),
        'reportFooter'   => __( 'Source: Deribit public market data. Implied volatility computed by Ethos Research. This report is information, not investment advice.', 'ethos' ),
        'side_otm'       => __( 'Out of the money', 'ethos' ),
        'side_C'         => __( 'Calls', 'ethos' ),
        'side_P'         => __( 'Puts', 'ethos' ),
        'axis'           => __( 'Axis', 'ethos' ),
        'maxSpread'      => __( 'Maximum spread', 'ethos' ),
        'range'          => __( 'Expiry range', 'ethos' ),
        'index'          => __( 'Index price', 'ethos' ),
        'at30'           => __( '30-day', 'ethos' ),
    );
}

/* ---------- Page ---------- */

add_shortcode( 'ethos_volsurface', static function () {
    $version = ETHOS_VOL_VERSION;
    wp_enqueue_style( 'ethos-vol', plugins_url( 'explorer.css', __FILE__ ), array(), $version );
    wp_enqueue_script( 'ethos-vol-plotly', plugins_url( 'vendor/plotly-gl3d-2.35.2.min.js', __FILE__ ), array(), '2.35.2', true );
    wp_enqueue_script( 'ethos-vol-core', plugins_url( 'core.js', __FILE__ ), array(), $version, true );
    wp_enqueue_script( 'ethos-report', plugins_url( 'report.js', __FILE__ ), array(), $version, true );
    wp_enqueue_script( 'ethos-vol', plugins_url( 'explorer.js', __FILE__ ), array( 'ethos-vol-core', 'ethos-vol-plotly', 'ethos-report' ), $version, true );
    $id    = wp_unique_id( 'ethos-vol-' );
    $tools = home_url( '/research/tools/' );
    $research = home_url( '/research/' );
    if ( function_exists( 'ethos_localize_internal_url' ) && function_exists( 'ethos_current_language_slug' ) ) {
        $tools    = ethos_localize_internal_url( $tools, ethos_current_language_slug() );
        $research = ethos_localize_internal_url( $research, ethos_current_language_slug() );
    }
    ob_start();
    ?>
    <section class="ethos-vol alignwide" aria-labelledby="<?php echo esc_attr( $id ); ?>-title"
        data-endpoint="<?php echo esc_url( rest_url( 'ethos-vol/v1/surface' ) ); ?>"
        data-i18n="<?php echo esc_attr( wp_json_encode( ethos_vol_i18n() ) ); ?>">
        <header class="vol-heading">
            <nav class="vol-breadcrumb" aria-label="<?php esc_attr_e( 'Breadcrumb', 'ethos' ); ?>"><a href="<?php echo esc_url( $research ); ?>"><?php esc_html_e( 'Research', 'ethos' ); ?></a><span aria-hidden="true"> / </span><a href="<?php echo esc_url( $tools ); ?>"><?php esc_html_e( 'Tools', 'ethos' ); ?></a></nav>
            <p class="is-style-eyebrow"><?php esc_html_e( 'DERIBIT · CRYPTO OPTIONS · LIVE', 'ethos' ); ?></p>
            <h1 id="<?php echo esc_attr( $id ); ?>-title"><?php esc_html_e( 'Vol Surface Visualizer', 'ethos' ); ?></h1>
            <p class="vol-dek"><?php esc_html_e( 'A volatility surface is a 3D plot of option implied volatility against delta (or strike) and time to expiration, and it shows in one shape how much movement the options market is pricing for each horizon. We calculate implied volatility with the Black-Scholes formula from the mid-market option price on Deribit, and the surface refreshes every five minutes.', 'ethos' ); ?></p>
        </header>

        <div class="vol-data-status">
            <span class="vol-source"><span aria-hidden="true">●</span> <?php esc_html_e( 'Source: Deribit', 'ethos' ); ?></span>
            <p role="status" aria-live="polite" class="vol-status"><?php esc_html_e( 'Loading the Deribit options book…', 'ethos' ); ?></p>
            <button type="button" class="vol-retry" data-action="retry" hidden><?php esc_html_e( 'Try again', 'ethos' ); ?></button>
        </div>

        <div class="vol-switches">
            <div class="vol-switch" role="group" aria-label="<?php esc_attr_e( 'Coin', 'ethos' ); ?>">
                <span class="vol-switch__label"><?php esc_html_e( 'Coin', 'ethos' ); ?></span>
                <div class="vol-segmented"><?php foreach ( array_keys( ETHOS_VOL_COINS ) as $coin ) : ?><button type="button" data-coin="<?php echo esc_attr( $coin ); ?>" aria-pressed="false"><?php echo esc_html( $coin ); ?></button><?php endforeach; ?></div>
            </div>
            <div class="vol-switch" role="group" aria-label="<?php esc_attr_e( 'Options', 'ethos' ); ?>">
                <span class="vol-switch__label"><?php esc_html_e( 'Options', 'ethos' ); ?></span>
                <div class="vol-segmented">
                    <button type="button" data-side="otm" aria-pressed="false"><?php esc_html_e( 'Out of the money', 'ethos' ); ?></button>
                    <button type="button" data-side="C" aria-pressed="false"><?php esc_html_e( 'Calls', 'ethos' ); ?></button>
                    <button type="button" data-side="P" aria-pressed="false"><?php esc_html_e( 'Puts', 'ethos' ); ?></button>
                </div>
            </div>
            <div class="vol-switch" role="group" aria-label="<?php esc_attr_e( 'Axis', 'ethos' ); ?>">
                <span class="vol-switch__label"><?php esc_html_e( 'Axis', 'ethos' ); ?></span>
                <div class="vol-segmented">
                    <button type="button" data-axis="delta" aria-pressed="false"><?php esc_html_e( 'Delta', 'ethos' ); ?></button>
                    <button type="button" data-axis="strike" aria-pressed="false"><?php esc_html_e( 'Strike', 'ethos' ); ?></button>
                    <button type="button" data-axis="moneyness" aria-pressed="false"><?php esc_html_e( 'Strike / forward', 'ethos' ); ?></button>
                </div>
            </div>
            <div class="vol-switch" role="group" aria-label="<?php esc_attr_e( 'Chart', 'ethos' ); ?>">
                <span class="vol-switch__label"><?php esc_html_e( 'Chart', 'ethos' ); ?></span>
                <div class="vol-segmented">
                    <button type="button" data-chart="surface" aria-pressed="false"><?php esc_html_e( '3D surface', 'ethos' ); ?></button>
                    <button type="button" data-chart="heatmap" aria-pressed="false"><?php esc_html_e( 'Heatmap', 'ethos' ); ?></button>
                </div>
            </div>
        </div>

        <dl class="vol-metrics" aria-live="polite">
            <div><dt><?php esc_html_e( 'Index price', 'ethos' ); ?></dt><dd data-metric="index">—</dd></div>
            <div><dt><?php esc_html_e( '30-day ATM IV', 'ethos' ); ?></dt><dd data-metric="atm">—</dd></div>
            <div><dt><?php esc_html_e( '30-day 25Δ risk reversal', 'ethos' ); ?></dt><dd data-metric="rr25">—</dd></div>
            <div><dt><?php esc_html_e( '30-day 25Δ butterfly', 'ethos' ); ?></dt><dd data-metric="fly25">—</dd></div>
            <div><dt><?php esc_html_e( 'Options priced', 'ethos' ); ?></dt><dd data-metric="used">—</dd></div>
        </dl>

        <div class="vol-ai" hidden>
            <div class="vol-ai__row">
                <span class="vol-ai__label"><?php esc_html_e( 'Explain with AI', 'ethos' ); ?></span>
                <?php foreach ( array( 'ChatGPT', 'Claude', 'Perplexity' ) as $assistant ) : ?><a data-ai="<?php echo esc_attr( $assistant ); ?>" href="#" target="_blank" rel="noopener nofollow"><?php echo esc_html( $assistant ); ?></a><?php endforeach; ?>
                <button type="button" data-action="ai-copy"><?php esc_html_e( 'Copy prompt', 'ethos' ); ?></button>
            </div>
            <p class="vol-ai__note"><?php esc_html_e( 'Opens your assistant with the current surface in figures (ATM volatility, skew and butterfly by expiry) already written into a prompt that asks for a short explanation of what they show and how to use them. It then offers a downloadable figure with the Ethos Research watermark. The prompt is copied as well, so you can paste it if the chat opens empty.', 'ethos' ); ?></p>
            <p class="vol-ai__status" role="status" aria-live="polite"></p>
            <details class="vol-ai__prompt"><summary><?php esc_html_e( 'See the prompt', 'ethos' ); ?></summary><pre tabindex="0"></pre></details>
        </div>

        <div class="vol-workbench">
            <details class="vol-controls" open>
                <summary><?php esc_html_e( 'Filters', 'ethos' ); ?><span class="vol-controls__hint"><?php esc_html_e( 'Expiries, delta & spread', 'ethos' ); ?></span></summary>
                <div class="vol-controls__body">
                    <label class="vol-field"><span><?php esc_html_e( 'Minimum days to expiry', 'ethos' ); ?></span><input class="vol-mindays" type="number" min="0" max="1000" step="1" value="2" inputmode="numeric"></label>
                    <label class="vol-field"><span><?php esc_html_e( 'Maximum days to expiry', 'ethos' ); ?></span><input class="vol-maxdays" type="number" min="1" max="1000" step="1" value="400" inputmode="numeric"></label>
                    <label class="vol-field"><span><?php esc_html_e( 'Furthest delta shown', 'ethos' ); ?></span><select class="vol-deltamin">
                        <?php foreach ( array( '0.02' => '2Δ', '0.05' => '5Δ', '0.1' => '10Δ', '0.15' => '15Δ', '0.25' => '25Δ' ) as $v => $label ) : ?><option value="<?php echo esc_attr( $v ); ?>" <?php selected( $v, '0.05' ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?>
                    </select></label>
                    <label class="vol-field"><span><?php esc_html_e( 'Maximum bid–ask spread', 'ethos' ); ?></span><select class="vol-spread">
                        <?php foreach ( array( '10', '20', '30', '50', '100' ) as $v ) : ?><option value="<?php echo esc_attr( $v ); ?>" <?php selected( $v, '30' ); ?>><?php echo esc_html( $v ); ?>%</option><?php endforeach; ?>
                    </select></label>
                    <label class="vol-check"><input class="vol-points" type="checkbox" checked><?php esc_html_e( 'Show the quoted points', 'ethos' ); ?></label>
                    <p class="vol-help"><?php esc_html_e( 'Spread is (ask − bid) ÷ mid. Wide quotes give unreliable volatilities, so they are left out of the surface. Delta runs from the furthest out-of-the-money put to the furthest call shown.', 'ethos' ); ?></p>
                </div>
            </details>
            <div class="vol-chart-panel">
                <div class="vol-chart-heading"><h2 class="vol-chart-title"><?php esc_html_e( 'Implied volatility surface', 'ethos' ); ?></h2><span class="vol-units"><?php esc_html_e( '% A YEAR', 'ethos' ); ?></span></div>
                <div class="vol-toolbar">
                    <div class="vol-camera" role="group" aria-label="<?php esc_attr_e( 'Camera', 'ethos' ); ?>">
                        <button type="button" data-camera="iso" aria-pressed="true"><?php esc_html_e( '3D view', 'ethos' ); ?></button>
                        <button type="button" data-camera="smile" aria-pressed="false"><?php esc_html_e( 'Look along expiries', 'ethos' ); ?></button>
                        <button type="button" data-camera="term" aria-pressed="false"><?php esc_html_e( 'Look along strikes', 'ethos' ); ?></button>
                    </div>
                    <div class="vol-view-buttons"><button type="button" data-action="rotate" aria-pressed="false" hidden><?php esc_html_e( 'Rotate chart', 'ethos' ); ?></button><button type="button" data-action="expand" aria-expanded="false"><?php esc_html_e( 'Expand chart', 'ethos' ); ?></button></div>
                </div>
                <div class="vol-chart vol-chart--surface" role="img" aria-label="<?php esc_attr_e( 'Interactive implied volatility surface', 'ethos' ); ?>" aria-describedby="<?php echo esc_attr( $id ); ?>-chart-help"></div>
                <p class="vol-empty" role="status" hidden></p>
                <p class="vol-chart-help" id="<?php echo esc_attr( $id ); ?>-chart-help"><?php esc_html_e( 'Drag to rotate, scroll or pinch to zoom, hover for values. Gaps mean no reliable quote at that point; the surface is never extrapolated. The tables below hold every number.', 'ethos' ); ?></p>
            </div>
        </div>

        <div class="vol-section-heading"><h2><?php esc_html_e( 'One expiry: the smile', 'ethos' ); ?></h2>
            <label class="vol-field vol-expiry-field"><span><?php esc_html_e( 'Expiry', 'ethos' ); ?></span><select class="vol-expiry"></select></label>
        </div>
        <div class="vol-chart vol-chart--smile" role="img" aria-label="<?php esc_attr_e( 'Implied volatility smile for the selected expiry', 'ethos' ); ?>"></div>

        <div class="vol-term-grid">
            <section><h2><?php esc_html_e( 'ATM volatility by expiry', 'ethos' ); ?></h2><div class="vol-chart vol-chart--term" role="img" aria-label="<?php esc_attr_e( 'At-the-money implied volatility by days to expiry', 'ethos' ); ?>"></div></section>
            <section><h2><?php esc_html_e( '25Δ risk reversal by expiry', 'ethos' ); ?></h2><div class="vol-chart vol-chart--skew" role="img" aria-label="<?php esc_attr_e( '25-delta risk reversal by days to expiry', 'ethos' ); ?>"></div></section>
        </div>

        <div class="vol-actions"><button type="button" data-action="copy"><?php esc_html_e( 'Copy link', 'ethos' ); ?></button><button type="button" data-action="csv-expiry"><?php esc_html_e( 'Download expiry CSV', 'ethos' ); ?></button><button type="button" data-action="csv-book"><?php esc_html_e( 'Download full book CSV', 'ethos' ); ?></button><button type="button" data-action="report-md"><?php esc_html_e( 'Download report (.md)', 'ethos' ); ?></button><button type="button" data-action="report-pdf"><?php esc_html_e( 'Download report (.pdf)', 'ethos' ); ?></button></div>
        <p class="vol-feedback" role="status" aria-live="polite"></p>

        <details class="vol-table-disclosure"><summary><?php esc_html_e( 'Term structure table', 'ethos' ); ?></summary><div class="vol-table-wrap" tabindex="0" role="region" aria-label="<?php esc_attr_e( 'Term structure table', 'ethos' ); ?>"><table class="vol-term-table"></table></div></details>
        <details class="vol-table-disclosure"><summary><?php esc_html_e( 'Quotes for the selected expiry', 'ethos' ); ?></summary><div class="vol-table-wrap" tabindex="0" role="region" aria-label="<?php esc_attr_e( 'Quotes for the selected expiry', 'ethos' ); ?>"><table class="vol-quote-table"></table></div></details>

        <div class="vol-reading">
            <section><h2><?php esc_html_e( 'How to read the surface', 'ethos' ); ?></h2>
                <p><?php esc_html_e( 'Height is implied volatility: the yearly movement, in percent, that option prices imply. A higher surface means the market is paying more for protection and for exposure to big moves.', 'ethos' ); ?></p>
                <p><?php esc_html_e( 'Along the expiry axis you read the term structure. It usually rises with time when markets are calm and inverts, with near expiries above far ones, when traders expect an event or are already living through one.', 'ethos' ); ?></p>
                <p><?php esc_html_e( 'Across delta or strike you read the skew. When out-of-the-money puts carry more volatility than calls, traders pay up for downside protection; when calls carry more, they are chasing upside. The 25-delta risk reversal measures that tilt in one number, and the butterfly measures how much extra the tails cost.', 'ethos' ); ?></p>
            </section>
            <section><h2><?php esc_html_e( 'Method', 'ethos' ); ?></h2>
                <p class="vol-formula"><?php esc_html_e( 'mid = (best bid + best ask) ÷ 2 → Black-Scholes → implied volatility', 'ethos' ); ?></p>
                <p><?php esc_html_e( 'Each option’s mid-market price is converted to an implied volatility with the Black-Scholes formula on its expiry’s forward price at a zero interest rate, the same convention Deribit uses. BTC and ETH options are quoted in coin, so their prices are first turned into dollars at the forward; SOL options are quoted in USDC. Delta is the Black-Scholes delta at that volatility. The bid and ask are converted the same way, so the smile chart shows how wide the market is around each point.', 'ethos' ); ?></p>
                <p><?php esc_html_e( 'Options without both a bid and an ask, or wider than the spread limit, are left out. The surface joins neighbouring quotes with straight lines along each expiry and leaves a gap where there are none. Deribit’s own mark volatility is shown beside ours as a check, never used in its place.', 'ethos' ); ?></p>
            </section>
            <section><h2><?php esc_html_e( 'Source & updates', 'ethos' ); ?></h2>
                <p><a href="https://docs.deribit.com/#public-get_book_summary_by_currency"><?php esc_html_e( 'Deribit public API · book summary by currency ↗', 'ethos' ); ?></a></p>
                <p><?php esc_html_e( 'The whole options book for each coin is fetched in one request every five minutes and whenever someone opens the page after the last book has turned five minutes old. Prices are best bid and best ask at that moment, not trades.', 'ethos' ); ?></p>
                <p><?php esc_html_e( 'This page is information, not investment advice.', 'ethos' ); ?></p>
            </section>
        </div>
        <p class="vol-credit"><?php esc_html_e( 'Idea and first version:', 'ethos' ); ?> <a href="https://github.com/dwasse/vol-surface-visualizer">vol-surface-visualizer</a> <?php esc_html_e( 'by Daniel Wasserman (0xhedge, 2019). Rebuilt for Ethos Research with independent code and the current Deribit API.', 'ethos' ); ?></p>
        <details class="vol-source-details"><summary><?php esc_html_e( 'Source coverage & checks', 'ethos' ); ?></summary><dl class="vol-diagnostics"></dl></details>
        <noscript><p><?php esc_html_e( 'JavaScript is required for this tool.', 'ethos' ); ?></p></noscript>
    </section>
    <?php
    return ob_get_clean();
} );
