# Card-face relief candidate

The existing card faces use a single flat gradient frame and flat cost/attack/life
circles. This candidate bakes a broad outside lip and recessed inside edge into
the existing 512×720 CanvasTexture. Medallions keep their original total radius
(including the old stroke), with a shaded rim around the unchanged central colour.

Names, rules, artwork crops, number values, fonts and positions are unchanged.
All five cosmetic finish palettes remain distinct. There are no new meshes,
materials, textures, lights or recurring animation jobs. Shading is generated only
when the existing face paint runs; hand selection still uses its separate focus
outline. The optional constructor argument is for isolated before/after review,
not a user-facing quality switch.

A pure regression compares all text and image draw commands for three cards,
five finishes, both face modes and reduced costs; it also verifies original image
dimensions, texture reuse and disposal. It records canvas calls, not pixels.
The optional offline preview uses the existing development canvas module and is
not browser or gameplay acceptance.

The isolated real-WebGL fixture compares identical art, costs and camera at 160px
and 96px card widths; expect ten texture entries and ten plane submissions per
sheet. Existing real hand, pack, focus, cancellation and post-combat play tests
remain separate. Keep only if independent original-image review sees a useful
material improvement without noisy borders, obscured numerals or a focus-state
look on unselected cards. The outstanding normal-motion gate remains unchanged.
