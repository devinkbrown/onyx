module Translate exposing
    ( Translatable
    , Translation
    , TranslationRequest
    , applyTranslationResult
    , buildTranslationRequest
    , isTranslationTarget
    , languageLabel
    , maxResultLength
    , maxSourceLength
    , normalizeLang
    , readinessDetail
    , readinessLabel
    , resolveTranslationTarget
    , storageKey
    , translationProvenance
    , translationTargets
    )

{-| On-device translation pure layer (mirroring
`src/lib/intelligence/translateMessage.ts`: the browser
Translator API stays behind ports — like the oracle `Translator`
interface hides it behind an adapter — while this module owns the
request/result shaping, language normalisation, and target
 bookkeeping. Provenance is always the device scope: Onyx never
hands text to a hidden external endpoint, and results stay
transient (never persisted). -}


{-| Keep local model requests and transient results within a
predictable memory budget. -}
maxSourceLength : Int
maxSourceLength =
    4096


maxResultLength : Int
maxResultLength =
    8192


{-| On-device translation is computed locally, so its provenance
is always the device scope. -}
translationProvenance : String
translationProvenance =
    "device"


{-| Curated set of on-device translation targets surfaced in
Preferences. -}
translationTargets : List String
translationTargets =
    [ "en"
    , "es"
    , "fr"
    , "de"
    , "pt"
    , "it"
    , "nl"
    , "ja"
    , "zh"
    , "ko"
    , "ru"
    , "ar"
    , "hi"
    ]


{-| Storage key for the chosen target (`onyx:` prefix — never
renamed). -}
storageKey : String
storageKey =
    "onyx:translation-target"


{-| The translated text plus its provenance scope. -}
type alias Translation =
    { translated : String
    , targetLang : String
    , provenance : String
    }


{-| Minimal translatable view record. For an E2EE DM the display
text is the decrypted plaintext, never the ciphertext envelope. -}
type alias Translatable =
    { text : String
    , lang : Maybe String
    , translation : Maybe Translation
    }


{-| A model-independent request describing what to translate. -}
type alias TranslationRequest =
    { sourceText : String
    , targetLang : String
    , passthrough : Bool
    }


{-| Lowercase + reduce a locale tag to its primary subtag
(`pt-BR` → `pt`). -}
normalizeLang : String -> String
normalizeLang lang =
    String.trim lang
        |> String.toLower
        |> String.replace "_" "-"
        |> String.split "-"
        |> List.head
        |> Maybe.withDefault ""


{-| Resolve the effective on-device target: a stored preference,
else the browser fallback, else English. -}
resolveTranslationTarget : String -> String -> String
resolveTranslationTarget stored fallback =
    case normalizeLang stored of
        "" ->
            case normalizeLang fallback of
                "" ->
                    "en"

                fb ->
                    fb

        target ->
            target


{-| Build a model-independent translation request. Passthrough is
flagged when the text is empty/whitespace, the target is empty,
or a known source language already matches the target. Source
whitespace is preserved byte-identical for the model. -}
buildTranslationRequest : Translatable -> String -> TranslationRequest
buildTranslationRequest message targetLang =
    let
        normalizedTarget =
            normalizeLang targetLang

        sourceText =
            String.left maxSourceLength message.text

        sourceLang =
            Maybe.map normalizeLang message.lang
    in
    { sourceText = sourceText
    , targetLang = normalizedTarget
    , passthrough =
        String.isEmpty (String.trim sourceText)
            || String.isEmpty normalizedTarget
            || sourceLang == Just normalizedTarget
    }


{-| Return a NEW message with the translation attached
(immutable). Provenance is forced to the device scope. -}
applyTranslationResult : Translatable -> String -> String -> Translatable
applyTranslationResult message translated targetLang =
    { message
        | translation =
            Just
                { translated = String.left maxResultLength translated
                , targetLang = normalizeLang targetLang
                , provenance = translationProvenance
                }
    }


{-| Whether a subtag is in the curated target list. -}
isTranslationTarget : String -> Bool
isTranslationTarget code =
    List.member code translationTargets


targetLabels : List ( String, String )
targetLabels =
    [ ( "en", "English" )
    , ( "es", "Spanish" )
    , ( "fr", "French" )
    , ( "de", "German" )
    , ( "pt", "Portuguese" )
    , ( "it", "Italian" )
    , ( "nl", "Dutch" )
    , ( "ja", "Japanese" )
    , ( "zh", "Chinese" )
    , ( "ko", "Korean" )
    , ( "ru", "Russian" )
    , ( "ar", "Arabic" )
    , ( "hi", "Hindi" )
    ]


{-| Readiness label for the local translator state (mirroring
`localTranslationReadiness`). -}
readinessLabel : Bool -> String
readinessLabel available =
    if available then
        "Browser local translator available"

    else
        "No browser local translator detected"


{-| Readiness detail for the local translator state. -}
readinessDetail : Bool -> String -> String
readinessDetail available targetLang =
    if available then
        "Onyx can hand selected text to this browser's on-device translator for " ++ targetLang ++ "."

    else
        "Onyx will not send message text to an external translation endpoint. Copy text or transcript lines to a translator you choose."


{-| Human-readable label for a target subtag, falling back to the
uppercased code (so a non-curated but valid target still shows). -}
languageLabel : String -> String
languageLabel code =
    let
        normalized =
            normalizeLang code
    in
    case List.filter (\( c, _ ) -> c == normalized) targetLabels |> List.head of
        Just ( _, label ) ->
            label

        Nothing ->
            String.toUpper normalized
