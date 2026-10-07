module PrefsTest exposing (suite)

{-| Preferences parity vectors, mirroring
`src/lib/prefs/preferences.test.ts` + `sceneMotion.test.ts`:
vocabularies, host sanitizing, legacy migrations, per-field defaults,
and the storage envelope.
-}

import Expect
import Json.Encode as Encode
import Prefs exposing (..)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Prefs"
        [ test "vocabularies round-trip and reject" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "compact", "cozy", "roomy" ] (List.map densityToString densities)
                    , \_ -> Expect.equal [ "sm", "md", "lg" ] (List.map fontScaleToString fontScales)
                    , \_ -> Expect.equal Nothing (densityFromString "huge")
                    , \_ -> Expect.equal Nothing (fontScaleFromString "xl")
                    , \_ -> Expect.equal (Just ExperienceNetworkOps) (experienceModeFromString "irc-ops")
                    , \_ -> Expect.equal (Just ExperienceNetworkOps) (experienceModeFromString "network-ops")
                    , \_ -> Expect.equal Nothing (experienceModeFromString "root")
                    , \_ -> Expect.equal (Just SceneAdaptive) (parseSceneMotion "adaptive")
                    , \_ -> Expect.equal (Just SceneOff) (parseSceneMotion "off")
                    , \_ -> Expect.equal Nothing (parseSceneMotion "turbo")
                    , \_ -> Expect.equal "still" (sceneMotionToString SceneStill)
                    , \_ -> Expect.equal "onyx:preferences" preferencesStorageKey
                    , \_ -> Expect.equal "onyx:scene-motion" sceneMotionStorageKey
                    ]
                    ()
        , test "sanitizeBlockedHost strips dots and rejects junk" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "corp.local") (sanitizeBlockedHost "  .Corp.Local.  ")
                    , \_ -> Expect.equal Nothing (sanitizeBlockedHost "https://evil.example")
                    , \_ -> Expect.equal Nothing (sanitizeBlockedHost "evil.example/path")
                    , \_ -> Expect.equal Nothing (sanitizeBlockedHost "user@host")
                    , \_ -> Expect.equal Nothing (sanitizeBlockedHost "")
                    , \_ -> Expect.equal (Just "localhost") (sanitizeBlockedHost "localhost")
                    , \_ -> Expect.equal Nothing (sanitizeBlockedHost "-bad-.example")
                    ]
                    ()
        , test "parseBlockedHosts splits, dedupes, and caps" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal [ "a.example", "b.example" ]
                            (parseBlockedHosts (Encode.string "a.example, b.example, a.example"))
                    , \_ ->
                        Expect.equal [ "a.example" ]
                            (parseBlockedHosts (Encode.list Encode.string [ "a.example", "https://x", "a.example" ]))
                    , \_ -> Expect.equal [] (parseBlockedHosts (Encode.int 7))
                    , \_ ->
                        Expect.equal "a.example, b.example"
                            (formatBlockedHosts [ "a.example", "b.example" ])
                    ]
                    ()
        , test "stored records validate per field with defaults" <|
            \_ ->
                let
                    prefs =
                        decodePreferences "{\"density\":\"roomy\",\"fontScale\":\"huge\",\"reduceMotion\":true,\"experienceMode\":\"irc-ops\",\"clock\":\"12h\"}" Nothing
                in
                Expect.all
                    [ \_ -> Expect.equal DensityRoomy prefs.density
                    , \_ -> Expect.equal FontMedium prefs.fontScale
                    , \_ -> Expect.equal True prefs.reduceMotion
                    , \_ -> Expect.equal ExperienceNetworkOps prefs.experienceMode
                    , \_ -> Expect.equal Clock12h prefs.clock
                    , \_ -> Expect.equal True prefs.linkPreviews
                    ]
                    ()
        , test "legacy high-contrast fills only a missing boolean" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (decodePreferences "{}" (Just "1")).highContrast
                    , \_ -> Expect.equal False (decodePreferences "{\"highContrast\":false}" (Just "1")).highContrast
                    , \_ -> Expect.equal False (decodePreferences "{}" Nothing).highContrast
                    , \_ -> Expect.equal False (decodePreferences "not json" (Just "1")).highContrast
                    , \_ -> Expect.equal False (decodePreferences "[1]" Nothing).highContrast
                    ]
                    ()
        , test "encode round-trips through decode" <|
            \_ ->
                let
                    prefs =
                        { defaultPreferences | density = DensityCompact, blockedHosts = [ "a.example" ] }

                    back =
                        decodePreferences (encodePreferences prefs) Nothing
                in
                Expect.all
                    [ \_ -> Expect.equal prefs back
                    , \_ -> Expect.equal defaultPreferences (decodePreferences (encodePreferences defaultPreferences) Nothing)
                    ]
                    ()
        , test "updatePreference edits page keys and guards the rest" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal FontLarge (updatePreference defaultPreferences "fontScale" "lg").fontScale
                    , \_ -> Expect.equal FontMedium (updatePreference defaultPreferences "fontScale" "huge").fontScale
                    , \_ -> Expect.equal DensityRoomy (updatePreference defaultPreferences "density" "roomy").density
                    , \_ -> Expect.equal True (updatePreference defaultPreferences "reduceMotion" "true").reduceMotion
                    , \_ -> Expect.equal Clock12h (updatePreference defaultPreferences "clock" "12h").clock
                    , \_ -> Expect.equal Clock24h (updatePreference defaultPreferences "clock" "nope").clock
                    , \_ -> Expect.equal False (updatePreference defaultPreferences "e2eeDms" "false").e2eeDms
                    , \_ -> Expect.equal False (updatePreference defaultPreferences "e2eeDms" "yes").e2eeDms
                    , \_ -> Expect.equal False (updatePreference defaultPreferences "linkPreviews" "false").linkPreviews
                    , \_ -> Expect.equal False (updatePreference defaultPreferences "httpsOnly" "false").httpsOnly
                    ]
                    ()
        ]
