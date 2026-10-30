<?php

declare(strict_types=1);

namespace Tests;

use App\Greeting;
use PHPUnit\Framework\TestCase;

final class GreetingTest extends TestCase
{
    public function testGreetsTheWorldByDefault(): void
    {
        $this->assertSame('Hello, world!', Greeting::for(''));
    }

    public function testGreetsAName(): void
    {
        $this->assertSame('Hello, Ada!', Greeting::for(' Ada '));
    }
}
