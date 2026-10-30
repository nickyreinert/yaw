<?php

declare(strict_types=1);

use App\Handler;

require __DIR__ . '/vendor/autoload.php';

// Bref calls this function for each Lambda event.
return static fn (mixed $event): array => Handler::handle(is_array($event) ? $event : []);
