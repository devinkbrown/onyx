module TranslateTest exposing (suite)

{-| Oracle-mirrored vectors for the translation pure layer
(mirroring `src/lib/intelligence/translateMessage.test.ts`:
normalisation, target resolution, request shaping, result
application, labels; the async orchestration and the browser
adapter stay ports-side). -}

import Expect
import Test exposing (Test, describe, test)
import Translate exposing (..)


suite : Test
suite =
    describe "Translate"
        [ describe "normalizeLang"
            [ test "lowercases and reduces to the primary subtag" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "pt" (normalizeLang "pt-BR")
                        , \_ -> Expect.equal "en" (normalizeLang "EN_us")
                        , \_ -> Expect.equal "ja" (normalizeLang "  Ja  ")
                        ]
                        ()
            , test "handles separator-only and multi-part tags as fail-closed primary subtags" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "" (normalizeLang "-US")
                        , \_ -> Expect.equal "zh" (normalizeLang "zh-Hant-TW")
                        ]
                        ()
            , test "returns empty string for empty input" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "" (normalizeLang "")
                        , \_ -> Expect.equal "" (normalizeLang "   ")
                        ]
                        ()
            ]
        , describe "resolveTranslationTarget"
            [ test "prefers the stored target" <|
                \_ ->
                    Expect.equal "fr" (resolveTranslationTarget "fr-FR" "de")
            , test "falls back to the browser value when nothing is stored" <|
                \_ ->
                    Expect.equal "de" (resolveTranslationTarget "" "de-DE")
            , test "defaults to en when neither is usable" <|
                \_ ->
                    Expect.equal "en" (resolveTranslationTarget "" "")
            , test "surfaces a non-curated browser fallback verbatim" <|
                \_ ->
                    let
                        resolved =
                            resolveTranslationTarget "" "sv-SE"
                    in
                    Expect.all
                        [ \_ -> Expect.equal "sv" resolved
                        , \_ -> Expect.equal False (isTranslationTarget resolved)
                        ]
                        ()
            ]
        , describe "buildTranslationRequest"
            [ test "builds a normal request when text and target differ from source" <|
                \_ ->
                    Expect.equal
                        { sourceText = "hola", targetLang = "en", passthrough = False }
                        (buildTranslationRequest { text = "hola", lang = Just "es", translation = Nothing } "EN-us")
            , test "flags passthrough for empty / whitespace text" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (buildTranslationRequest { text = "", lang = Nothing, translation = Nothing } "ja").passthrough
                        , \_ -> Expect.equal True (buildTranslationRequest { text = "   ", lang = Nothing, translation = Nothing } "ja").passthrough
                        ]
                        ()
            , test "flags passthrough for an empty target" <|
                \_ ->
                    Expect.equal True (buildTranslationRequest { text = "hello", lang = Nothing, translation = Nothing } "").passthrough
            , test "flags passthrough when source language already matches the target" <|
                \_ ->
                    Expect.equal True (buildTranslationRequest { text = "hello", lang = Just "en-GB", translation = Nothing } "en").passthrough
            , test "does not passthrough when source language is unknown" <|
                \_ ->
                    Expect.equal False (buildTranslationRequest { text = "hello", lang = Nothing, translation = Nothing } "ja").passthrough
            , test "preserves source whitespace exactly while still using trimmed text for passthrough" <|
                \_ ->
                    Expect.equal
                        { sourceText = "  hola  ", targetLang = "en", passthrough = False }
                        (buildTranslationRequest { text = "  hola  ", lang = Just "es-MX", translation = Nothing } "EN-US")
            , test "bounds source text before it can reach the local model" <|
                \_ ->
                    let
                        source =
                            String.repeat (maxSourceLength + 128) "a"

                        request =
                            buildTranslationRequest { text = source, lang = Nothing, translation = Nothing } "ja"
                    in
                    Expect.all
                        [ \_ -> Expect.equal maxSourceLength (String.length request.sourceText)
                        , \_ -> Expect.equal (String.left maxSourceLength source) request.sourceText
                        ]
                        ()
            ]
        , describe "applyTranslationResult"
            [ test "returns a new message tagged with device provenance" <|
                \_ ->
                    let
                        original =
                            { text = "hola", lang = Nothing, translation = Nothing }

                        next =
                            applyTranslationResult original "hello" "EN-us"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing original.translation
                        , \_ ->
                            Expect.equal
                                (Just { translated = "hello", targetLang = "en", provenance = translationProvenance })
                                next.translation
                        , \_ -> Expect.equal "device" translationProvenance
                        ]
                        ()
            , test "preserves the original source text and language" <|
                \_ ->
                    let
                        next =
                            applyTranslationResult { text = "hola", lang = Just "es", translation = Nothing } "hello" "en"
                    in
                    Expect.all
                        [ \_ -> Expect.equal "hola" next.text
                        , \_ -> Expect.equal (Just "es") next.lang
                        ]
                        ()
            , test "bounds transient model output without mutating the source message" <|
                \_ ->
                    let
                        translated =
                            String.repeat (maxResultLength + 128) "b"

                        original =
                            { text = "hola", lang = Just "es", translation = Nothing }

                        next =
                            applyTranslationResult original translated "en"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing original.translation
                        , \_ ->
                            Expect.equal
                                (Just maxResultLength)
                                (Maybe.map (String.length << .translated) next.translation)
                        , \_ ->
                            Expect.equal
                                (Just (String.left maxResultLength translated))
                                (Maybe.map .translated next.translation)
                        ]
                        ()
            ]
        , describe "languageLabel"
            [ test "labels curated targets and uppercases the rest" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Japanese" (languageLabel "ja")
                        , \_ -> Expect.equal "Portuguese" (languageLabel "pt-BR")
                        , \_ -> Expect.equal "SV" (languageLabel "sv")
                        ]
                        ()
            ]
        ]
