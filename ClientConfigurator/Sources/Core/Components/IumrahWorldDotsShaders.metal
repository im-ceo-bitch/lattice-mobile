#include <metal_stdlib>
using namespace metal;

/// SwiftUI colour shader for the iumrah 5,026-dot atlas.
///
/// Render cost scales with the displayed image size, NOT with the number of
/// dots. All dots remain fixed while two slowly undulating wave fronts alter
/// their white luminance/alpha. No coloured light or gradient is introduced.
///
/// Signature/argument order MUST match IumrahWorldDotsMap.swift exactly.
[[ stitchable ]]
half4 iumrahWorldDotWave(
    float2 position,
    half4 source,
    float time,
    float width,
    float height,
    float speed,
    float waveIntensity,
    float overallOpacity
) {
    // Purely transparent ocean pixels need no wave calculations.
    if (source.a <= half(0.0001)) {
        return half4(0.0h);
    }

    const float2 uv = position / float2(max(width, 1.0f), max(height, 1.0f));
    const float intensity = clamp(waveIntensity, 0.0f, 1.0f);
    const float gain = clamp(overallOpacity, 0.0f, 1.0f);
    const float motion = time * speed;

    // Slightly warped, moving light front: no mechanical straight scanning bar.
    const float bend = 0.17f * sin(uv.y * 8.5f + motion * 0.23f)
                     + 0.053f * cos(uv.y * 17.0f - motion * 0.13f);
    const float travel = (uv.x * 1.72f - motion * 0.14f + bend) * 6.2831853f;
    const float lightPhase = sin(travel);

    // Rounded highlights and broad soft shadows instead of sharp flashes.
    const float highlight = pow(max(lightPhase, 0.0f), 3.0f);
    const float shadow = pow(max(-lightPhase, 0.0f), 2.0f);
    const float breathing = 0.5f + 0.5f * sin(
        (uv.x * 0.8f + uv.y * 0.4f) * 9.1f - motion * 0.44f
    );

    const float dynamicLuminance = clamp(
        0.46f + 0.51f * highlight - 0.30f * shadow + 0.048f * breathing,
        0.18f,
        1.0f
    );
    const half brightness = half(mix(0.67f, dynamicLuminance, intensity) * gain);

    // The incoming atlas is premultiplied white; preserve premultiplication.
    // Multiplying the entire colour also dims its optical halo naturally.
    return source * brightness;
}
