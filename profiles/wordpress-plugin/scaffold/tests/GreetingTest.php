<?php
/**
 * Greeting tests.
 *
 * @package MyPlugin
 */

declare(strict_types=1);

namespace Tests;

use MyPlugin\Greeting;
use PHPUnit\Framework\TestCase;

final class GreetingTest extends TestCase {

	public function testGreetsByName(): void {
		$this->assertSame( 'Hello, Ada!', Greeting::for_name( 'Ada' ) );
	}

	public function testEmptyNameFallsBack(): void {
		$this->assertSame( 'Hello, world!', Greeting::for_name( '  ' ) );
	}
}
