<?php
/**
 * Plugin Name:       My Plugin
 * Description:       A small WordPress plugin.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.2
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       my-plugin
 *
 * @package MyPlugin
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/src/Greeting.php';

add_shortcode(
	'my_plugin_greeting',
	static function ( $atts ): string {
		$atts = shortcode_atts( array( 'name' => 'world' ), (array) $atts, 'my_plugin_greeting' );

		return esc_html( MyPlugin\Greeting::for_name( (string) $atts['name'] ) );
	}
);
