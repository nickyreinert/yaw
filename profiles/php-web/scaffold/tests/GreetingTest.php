<?php

declare(strict_types=1);

namespace Tests;

use App\Greeting;
use PHPUnit\Framework\TestCase;

final class GreetingTest extends TestCase
{
    public function testGreetsByName(): void
    {
        $this->assertSame('Hello, world!', Greeting::for('world'));
    }

    public function testEscapesHtml(): void
    {
        $this->assertSame('Hello, &lt;b&gt;!', Greeting::for('<b>'));
    }
}
