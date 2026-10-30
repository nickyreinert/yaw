<?php

declare(strict_types=1);

namespace Tests;

use App\Cli;
use PHPUnit\Framework\TestCase;

final class CliTest extends TestCase
{
    /**
     * @param list<string> $args
     *
     * @return array{int, string, string}
     */
    private function invoke(array $args): array
    {
        $out = fopen('php://memory', 'w+');
        $err = fopen('php://memory', 'w+');
        $this->assertIsResource($out);
        $this->assertIsResource($err);

        $code = Cli::run($args, $out, $err);
        rewind($out);
        rewind($err);

        return [$code, (string) stream_get_contents($out), (string) stream_get_contents($err)];
    }

    public function testGreetsTheWorldByDefault(): void
    {
        $this->assertSame([0, "Hello, world!\n", ''], $this->invoke([]));
    }

    public function testGreetsAName(): void
    {
        $this->assertSame([0, "Hello, Ada!\n", ''], $this->invoke(['Ada']));
    }

    public function testTooManyArgumentsFailWithUsage(): void
    {
        $this->assertSame([1, '', "usage: app [name]\n"], $this->invoke(['a', 'b']));
    }
}
