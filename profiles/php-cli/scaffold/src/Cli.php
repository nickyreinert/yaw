<?php

declare(strict_types=1);

namespace App;

final class Cli
{
    /**
     * @param list<string> $args
     * @param resource     $out
     * @param resource     $err
     *
     * @return int the exit code: 0 on success, 1 on bad usage
     */
    public static function run(array $args, $out, $err): int
    {
        if (count($args) > 1) {
            fwrite($err, "usage: app [name]\n");

            return 1;
        }

        fwrite($out, Greeting::for($args[0] ?? '') . "\n");

        return 0;
    }
}
