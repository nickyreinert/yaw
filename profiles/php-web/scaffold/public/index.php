<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Greeting;

header('Content-Type: text/plain; charset=utf-8');
echo Greeting::for('world');
