<?php
/**
 * Greeting text.
 *
 * @package MyPlugin
 */

declare(strict_types=1);

namespace MyPlugin;

/**
 * Pure logic, testable without WordPress.
 */
final class Greeting {

	/**
	 * Build the greeting for a name; an empty name falls back to "world".
	 *
	 * @param string $name Name to greet.
	 */
	public static function for_name( string $name ): string {
		$name = trim( $name );

		return 'Hello, ' . ( '' === $name ? 'world' : $name ) . '!';
	}
}
