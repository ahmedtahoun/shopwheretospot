<?php
// The one call to Claude (api/ai.php), through Anthropic's official PHP library (bundled in api/lib/vendor).
// Kept apart because it uses PHP 8 syntax: it's loaded only after ai_lib() has checked PHP 8.1+.

declare(strict_types=1);

require_once __DIR__ . '/lib/vendor/autoload.php';

// Returns the Message. The answer is JSON (reply, handover, product_id), checked against the schema by the API.
// Low effort: short shop answers don't need long thinking, and they come back faster.
function ai_claude_call(string $key, string $model, string $system, array $turns): object
{
    $client = new \Anthropic\Client(apiKey: $key);
    try {
        return $client->messages->create(
            model: $model,
            maxTokens: 2000,
            system: [['type' => 'text', 'text' => $system, 'cacheControl' => ['type' => 'ephemeral']]],
            messages: $turns,
            outputConfig: [
                'effort' => 'low',
                'format' => ['type' => 'json_schema', 'schema' => [
                    'type' => 'object',
                    'properties' => [
                        'reply' => ['type' => 'string', 'description' => 'The message to send the customer'],
                        'handover' => ['type' => 'boolean', 'description' => 'True when someone from the team should take over'],
                        'product_id' => ['type' => 'string', 'description' => 'The catalog id of the one product this reply is about, or empty'],
                    ],
                    'required' => ['reply', 'handover', 'product_id'],
                    'additionalProperties' => false,
                ]],
            ],
        );
    } catch (\Anthropic\Core\Exceptions\APIStatusException $e) {
        throw new RuntimeException('API ' . ($e->type?->value ?? 'error'));
    }
}
