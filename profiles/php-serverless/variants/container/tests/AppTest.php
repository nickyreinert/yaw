<?php

declare(strict_types=1);

namespace Tests;

use App\App;
use PHPUnit\Framework\TestCase;

final class AppTest extends TestCase
{
    public function testGreets(): void
    {
        $this->assertSame([200, ['Content-Type' => 'text/plain'], 'Hello, Ada!'], App::handle('GET', '/', 'Ada'));
    }

    public function testHealth(): void
    {
        $this->assertSame(200, App::handle('GET', '/health')[0]);
    }

    public function testUnknownPathIs404(): void
    {
        $this->assertSame(404, App::handle('GET', '/nope')[0]);
    }

    public function testWrongMethodIs405(): void
    {
        $this->assertSame(405, App::handle('POST', '/')[0]);
    }
}
