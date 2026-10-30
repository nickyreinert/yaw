<?php

declare(strict_types=1);

namespace Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Yaml\Yaml;

final class TemplateTest extends TestCase
{
    public function testTemplateIsValidYamlWithTheBrefFunction(): void
    {
        $template = Yaml::parseFile(__DIR__ . '/../template.yaml');
        $this->assertIsArray($template);
        $function = $template['Resources']['Function']['Properties'] ?? null;
        $this->assertIsArray($function);
        $this->assertSame('handler.php', $function['Handler']);
        $this->assertSame('provided.al2023', $function['Runtime']);
        $this->assertFileExists(__DIR__ . '/../' . $function['Handler']);
    }
}
