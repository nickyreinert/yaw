<?php

declare(strict_types=1);

namespace App;

final class Handler
{
    /**
     * @param array<mixed> $event
     *
     * @return array{statusCode: int, body: string}
     */
    public static function handle(array $event): array
    {
        $name = $event['name'] ?? '';

        return ['statusCode' => 200, 'body' => Greeting::for(is_string($name) ? $name : '')];
    }
}
