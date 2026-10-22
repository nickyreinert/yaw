<?php
/**
 * Type error fixture.
 *
 * @package MyPlugin
 */

declare(strict_types=1);

/**
 * Add two numbers.
 *
 * @param int $a First.
 * @param int $b Second.
 */
function my_plugin_add( int $a, int $b ): int {
	return $a + $b;
}

my_plugin_add( '1', 2 );
