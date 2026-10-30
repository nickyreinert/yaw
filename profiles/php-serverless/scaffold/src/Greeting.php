<?php

declare(strict_types=1);

namespace App;

final class Greeting
{
    public static function for(string $name): string
    {
        $name = trim($name);

        return 'Hello, ' . ($name === '' ? 'world' : $name) . '!';
    }
}
