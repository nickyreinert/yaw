<?php

declare(strict_types=1);

namespace App;

final class Greeting
{
    public static function for(string $name): string
    {
        return 'Hello, ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '!';
    }
}
