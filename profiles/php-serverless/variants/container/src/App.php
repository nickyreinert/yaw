<?php

declare(strict_types=1);

namespace App;

final class App
{
    /**
     * @return array{int, array<string, string>, string} status, headers, body
     */
    public static function handle(string $method, string $path, string $name = ''): array
    {
        if ($path === '/health') {
            return [200, ['Content-Type' => 'text/plain'], 'ok'];
        }
        if ($path !== '/') {
            return [404, ['Content-Type' => 'text/plain'], 'not found'];
        }
        if ($method !== 'GET') {
            return [405, ['Content-Type' => 'text/plain', 'Allow' => 'GET'], 'method not allowed'];
        }

        return [200, ['Content-Type' => 'text/plain'], Greeting::for($name)];
    }
}
