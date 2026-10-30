<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\App;

$method = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
$uri = is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/';
$path = parse_url($uri, PHP_URL_PATH);
$name = $_GET['name'] ?? '';

[$status, $headers, $body] = App::handle($method, is_string($path) ? $path : '/', is_string($name) ? $name : '');

http_response_code($status);
foreach ($headers as $key => $value) {
    header($key . ': ' . $value);
}
echo $body;
