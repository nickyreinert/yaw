<?php

declare(strict_types=1);

namespace Tests;

use App\Handler;
use PHPUnit\Framework\TestCase;

final class HandlerTest extends TestCase
{
    public function testGreetsTheWorldByDefault(): void
    {
        $this->assertSame(['statusCode' => 200, 'body' => 'Hello, world!'], Handler::handle([]));
    }

    public function testGreetsAName(): void
    {
        $this->assertSame('Hello, Ada!', Handler::handle(['name' => 'Ada'])['body']);
    }

    public function testHandlerFileReturnsTheFunction(): void
    {
        $function = require __DIR__ . '/../handler.php';
        $this->assertIsCallable($function);
        $this->assertSame(200, $function(['name' => 'Ada'])['statusCode']);
    }
}
