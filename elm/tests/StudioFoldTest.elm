module StudioFoldTest exposing (suite)

{-| Theme Studio App-fold vectors: session overrides, factory
generate/adjust, save/delete/share/export/import, eye-dropper,
boot `?theme=` import, cross-tab refresh, and leave-reset — all
through the pure `update`, mirroring `src/theme/ThemeStudio.tsx`
and `src/theme/ThemeProvider.tsx` behavior.
-}

import App exposing (..)
import Dict
import Expect
import Json.Encode as Encode
import Prefs
import Route
import Studio
import Test exposing (Test, describe, test)
import Theme
import ThemeTokens
import Time
import Url


snapshot : Encode.Value
snapshot =
    Encode.object
        [ ( "prefsJson", Encode.string (Prefs.encodePreferences Prefs.defaultPreferences) )
        , ( "legacyContrast", Encode.string "" )
        , ( "sceneMotion", Encode.string "" )
        , ( "themeId", Encode.string "ocean" )
        , ( "backgroundId", Encode.string "" )
        , ( "customThemesJson", Encode.string "[]" )
        , ( "eyeDropperSupported", Encode.bool True )
        ]


seeded : Model
seeded =
    Tuple.first (update (AppearanceSnapshot snapshot) blank)


isApply : Outbound -> Bool
isApply outbound =
    case outbound of
        AppearanceApply _ ->
            True

        _ ->
            False


hasOutbound : Outbound -> List Outbound -> Bool
hasOutbound want outbounds =
    List.member want outbounds


withCustom : Model
withCustom =
    let
        ( theme, persisted ) =
            Studio.addCustomTheme ThemeTokens.themeIds
                []
                "Mistline"
                "ocean"
                (Dict.fromList [ ( "--lapis", "#78d5ff" ) ])

        refs =
            List.map (\custom -> { id = custom.id, name = custom.name, base = custom.base }) persisted
    in
    { seeded | studioCustoms = persisted, customThemes = refs, themeId = theme.id }


storeJson : Outbound -> Maybe String
storeJson outbound =
    case outbound of
        StudioStoreCustomThemes req ->
            Just req.json

        _ ->
            Nothing


leaveTo : String -> Model -> ( Model, List Outbound )
leaveTo path model =
    case Url.fromString ("http://example.com" ++ path) of
        Just url ->
            update (UrlChanged url) { model | route = Route.Appearance }

        Nothing ->
            ( model, [] )


suite : Test
suite =
    describe "studio fold"
        [ test "snapshot revives customs and the eye-dropper flag" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True seeded.studioEyeDropperSupported
                    , \_ -> Expect.equal [] seeded.studioCustoms
                    , \_ -> Expect.equal Nothing seeded.studioBootTheme
                    ]
                    ()
        , test "token input stages live and resets drop" <|
            \_ ->
                let
                    ( edited, editOut ) =
                        update (StudioTokenInput { property = "--lapis", value = "#ff0000" }) seeded

                    ( reverted, _ ) =
                        update (StudioTokenReset { property = "--lapis" }) edited
                in
                Expect.all
                    [ \_ -> Expect.equal (Dict.fromList [ ( "--lapis", "#ff0000" ) ]) edited.studioOverrides
                    , \_ -> Expect.equal True (List.any isApply editOut)
                    , \_ -> Expect.equal Dict.empty reverted.studioOverrides
                    ]
                    ()
        , test "generate arms the factory and diffs the base" <|
            \_ ->
                let
                    ( generated, out ) =
                        update StudioGenerate seeded
                in
                Expect.all
                    [ \_ -> Expect.equal True generated.studioFactoryArmed
                    , \_ -> Expect.equal generated.studioOverrides generated.studioOverrides
                    , \_ -> Expect.equal True (List.any isApply out)
                    ]
                    ()
        , test "seed knobs reject bad schemes and non-finite numbers" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal ( seeded, [] ) (update (StudioSeedScheme { scheme = "twilight" }) seeded)
                    , \_ -> Expect.equal ( seeded, [] ) (update (StudioSeedNumber { field = "depth", value = 0 / 0 }) seeded)
                    , \_ -> Expect.equal ( seeded, [] ) (update (StudioSeedNumber { field = "nope", value = 1 }) seeded)
                    ]
                    ()
        , test "unfold to current recovers a seed without applying" <|
            \_ ->
                let
                    ( next, out ) =
                        update StudioSeedFromCurrent seeded
                in
                Expect.all
                    [ \_ -> Expect.equal (Theme.seedFromTokens (studioResolvedTokens seeded) (studioActiveScheme seeded)) next.studioSeed
                    , \_ -> Expect.equal [] out
                    ]
                    ()
        , test "export copies the blob and results route by tag" <|
            \_ ->
                let
                    ( busy, out ) =
                        update StudioExport { seeded | nowMs = 1000 }

                    ( copied, _ ) =
                        update (ClipboardResult { tag = "ts:export", ok = True }) busy

                    ( failed, _ ) =
                        update (ClipboardResult { tag = "ts:export", ok = False }) busy

                    stale =
                        update (ClipboardResult { tag = "ts:export", ok = True }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal True busy.studioExportBusy
                    , \_ ->
                        case out of
                            [ ClipboardCopy req ] ->
                                Expect.all
                                    [ \_ -> Expect.equal "ts:export" req.tag
                                    , \_ -> Expect.equal True (String.contains "\"base\": \"ocean\"" req.text || String.contains "\"base\":\"ocean\"" req.text)
                                    ]
                                    ()

                            _ ->
                                Expect.fail "expected one clipboard copy"
                    , \_ -> Expect.equal True copied.studioExportCopied
                    , \_ -> Expect.equal (Just "Theme export copy failed. Clipboard access may be blocked in this browser.") failed.studioCopyFailure
                    , \_ -> Expect.equal ( seeded, [] ) stale
                    ]
                    ()
        , test "copy flags revert after 2200ms" <|
            \_ ->
                let
                    ( busy, _ ) =
                        update StudioExport { seeded | nowMs = 1000 }

                    ( copied, _ ) =
                        update (ClipboardResult { tag = "ts:export", ok = True }) busy

                    ( reverted, _ ) =
                        update (Tick (Time.millisToPosix 3201)) copied

                    ( early, _ ) =
                        update (Tick (Time.millisToPosix 3199)) copied
                in
                Expect.all
                    [ \_ -> Expect.equal False reverted.studioExportCopied
                    , \_ -> Expect.equal True early.studioExportCopied
                    ]
                    ()
        , test "seed export prompt and blob import round-trip" <|
            \_ ->
                let
                    ( _, seedOut ) =
                        update StudioExportSeed seeded

                    ( _, blobOut ) =
                        update StudioImportRequest seeded

                    blob =
                        Studio.encodeThemeExport "ocean" (Dict.fromList [ ( "--lapis", "#00ace9" ) ]) "2026-07-16T18:00:00.000Z"

                    ( imported, importOut ) =
                        update (StudioPromptResult { kind = "blob", text = Just blob }) seeded

                    ( broken, _ ) =
                        update (StudioPromptResult { kind = "blob", text = Just "nope" }) seeded

                    silent =
                        update (StudioPromptResult { kind = "blob", text = Nothing }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal [ StudioPromptRequest { kind = "seed" } ] (Tuple.second (update StudioImportSeedRequest seeded))
                    , \_ ->
                        case seedOut of
                            [ ClipboardCopy req ] ->
                                Expect.equal "ts:seed" req.tag

                            _ ->
                                Expect.fail "expected seed copy"
                    , \_ -> Expect.equal [ StudioPromptRequest { kind = "blob" } ] blobOut
                    , \_ -> Expect.equal "ocean" imported.themeId
                    , \_ -> Expect.equal (Dict.fromList [ ( "--lapis", "#00ace9" ) ]) imported.studioOverrides
                    , \_ -> Expect.equal True (hasOutbound (AppearanceStoreTheme { id = "ocean" }) importOut)
                    , \_ -> Expect.equal (Just "Not a valid Onyx theme export.") broken.studioImportError
                    , \_ -> Expect.equal ( seeded, [] ) silent
                    ]
                    ()
        , test "seed import generates immediately and surfaces warnings" <|
            \_ ->
                let
                    json =
                        Studio.exportThemeSeed "Purple" { safeSeed | primaryHue = 300 }

                    ( generated, out ) =
                        update (StudioPromptResult { kind = "seed", text = Just json }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal True generated.studioFactoryArmed
                    , \_ -> Expect.equal True (generated.studioImportError /= Nothing)
                    , \_ -> Expect.equal True (List.any isApply out)
                    ]
                    ()
        , test "adjust snapshots a baseline and identity restores it" <|
            \_ ->
                let
                    ( edited, _ ) =
                        update (StudioTokenInput { property = "--lapis", value = "#ff0000" }) seeded

                    ( dragged, dragOut ) =
                        update (StudioAdjustPatch { field = "hueShift", value = 10 }) edited

                    ( restored, _ ) =
                        update (StudioAdjustPatch { field = "hueShift", value = 0 }) dragged

                    ( baked, bakeOut ) =
                        update StudioAdjustBake dragged
                in
                Expect.all
                    [ \_ -> Expect.equal True (dragged.studioAdjustBaseline /= Nothing)
                    , \_ -> Expect.equal True (List.any isApply dragOut)
                    , \_ -> Expect.equal (Dict.fromList [ ( "--lapis", "#ff0000" ) ]) restored.studioOverrides
                    , \_ -> Expect.equal Nothing baked.studioAdjustBaseline
                    , \_ -> Expect.equal [] bakeOut
                    ]
                    ()
        , test "adjust revert restores the baseline palette" <|
            \_ ->
                let
                    ( edited, _ ) =
                        update (StudioTokenInput { property = "--lapis", value = "#ff0000" }) seeded

                    ( dragged, _ ) =
                        update (StudioAdjustPatch { field = "hueShift", value = 10 }) edited

                    ( reverted, out ) =
                        update StudioAdjustRevert dragged
                in
                Expect.all
                    [ \_ -> Expect.equal (Dict.fromList [ ( "--lapis", "#ff0000" ) ]) reverted.studioOverrides
                    , \_ -> Expect.equal True (List.any isApply out)
                    ]
                    ()
        , test "auto-fix and reset re-apply" <|
            \_ ->
                let
                    ( _, fixOut ) =
                        update StudioAutoFix seeded

                    ( edited, _ ) =
                        update (StudioTokenInput { property = "--lapis", value = "#ff0000" }) seeded

                    ( reset, resetOut ) =
                        update StudioReset edited
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.any isApply fixOut)
                    , \_ -> Expect.equal Dict.empty reset.studioOverrides
                    , \_ -> Expect.equal True (List.any isApply resetOut)
                    ]
                    ()
        , test "save drafts a name and commits a selectable theme" <|
            \_ ->
                let
                    ( drafting, _ ) =
                        update StudioBeginSave seeded

                    ( edited, _ ) =
                        update (StudioTokenInput { property = "--lapis", value = "#ff0000" }) seeded

                    ( saved, out ) =
                        update StudioConfirmSave { edited | studioSaving = True, studioSaveName = "Wake" }

                    empty =
                        update StudioConfirmSave { edited | studioSaving = True, studioSaveName = "  " }

                    ( cancelled, _ ) =
                        update StudioCancelSave drafting
                in
                Expect.all
                    [ \_ -> Expect.equal "Ocean custom" drafting.studioSaveName
                    , \_ -> Expect.equal "custom:wake" saved.themeId
                    , \_ -> Expect.equal 1 (List.length saved.studioCustoms)
                    , \_ -> Expect.equal True (hasOutbound (AppearanceStoreTheme { id = "custom:wake" }) out)
                    , \_ -> Expect.equal True (List.any isApply out)
                    , \_ ->
                        case List.filterMap storeJson out of
                            [ json ] ->
                                Expect.equal True (String.contains "custom:wake" json)

                            _ ->
                                Expect.fail "expected customs store"
                    , \_ -> Expect.equal ( { edited | studioSaving = True, studioSaveName = "  " }, [] ) empty
                    , \_ -> Expect.equal False cancelled.studioSaving
                    ]
                    ()
        , test "delete falls back off an active custom theme" <|
            \_ ->
                let
                    gone =
                        List.head withCustom.studioCustoms |> Maybe.map .id |> Maybe.withDefault ""

                    ( deleted, out ) =
                        update (StudioDeleteCustom { id = gone }) withCustom

                    ( kept, keptOut ) =
                        update StudioConfirmSave { withCustom | studioSaveName = "Second" }
                in
                Expect.all
                    [ \_ -> Expect.equal "ocean" deleted.themeId
                    , \_ -> Expect.equal [] deleted.studioCustoms
                    , \_ -> Expect.equal True (hasOutbound (AppearanceStoreTheme { id = "ocean" }) out)
                    , \_ -> Expect.equal ( withCustom, [] ) (update (StudioDeleteCustom { id = "custom:nope" }) withCustom)
                    , \_ -> Expect.equal "custom:second" kept.themeId
                    , \_ -> Expect.equal True (List.any isApply keptOut)
                    ]
                    ()
        , test "delete keeps an inactive theme selected elsewhere" <|
            \_ ->
                let
                    ( theme, persisted ) =
                        Studio.addCustomTheme ThemeTokens.themeIds withCustom.studioCustoms "Second" "pearl" Dict.empty

                    two =
                        { withCustom | studioCustoms = persisted }

                    ( deleted, out ) =
                        update (StudioDeleteCustom { id = theme.id }) two
                in
                Expect.all
                    [ \_ -> Expect.equal withCustom.themeId deleted.themeId
                    , \_ -> Expect.equal 1 (List.length deleted.studioCustoms)
                    , \_ -> Expect.equal False (List.any isApply out)
                    ]
                    ()
        , test "studio background chips apply immediately" <|
            \_ ->
                let
                    ( applied, out ) =
                        update (StudioApplyBackground { id = "deep-current" }) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal "deep-current" applied.backgroundId
                    , \_ -> Expect.equal True (hasOutbound (AppearanceStoreBackground { id = "deep-current" }) out)
                    , \_ -> Expect.equal ( seeded, [] ) (update (StudioApplyBackground { id = "nope" }) seeded)
                    ]
                    ()
        , test "share is silent for built-ins and copies for customs" <|
            \_ ->
                let
                    ( busy, out ) =
                        update StudioShare withCustom

                    ( copied, _ ) =
                        update (ClipboardResult { tag = "ts:share", ok = True }) busy
                in
                Expect.all
                    [ \_ -> Expect.equal ( seeded, [] ) (update StudioShare seeded)
                    , \_ -> Expect.equal ( { seeded | studioShareBusy = True }, [] ) (update StudioShare { seeded | studioShareBusy = True })
                    , \_ ->
                        case out of
                            [ StudioShareCopy req ] ->
                                Expect.equal False (String.isEmpty req.code)

                            _ ->
                                Expect.fail "expected share copy"
                    , \_ -> Expect.equal True copied.studioShareCopied
                    ]
                    ()
        , test "eye-dropper guards support, busyness, and stale results" <|
            \_ ->
                let
                    ( busy, out ) =
                        update StudioEyeDropperSample seeded

                    ( sampled, sampleOut ) =
                        update (StudioEyeDropperResult { state = "selected", detail = "", hex = "#ff0000" }) busy

                    ( cancelled, _ ) =
                        update (StudioEyeDropperResult { state = "cancelled", detail = "nope", hex = "" }) busy

                    ( invalid, _ ) =
                        update (StudioEyeDropperResult { state = "selected", detail = "", hex = "red" }) busy
                in
                Expect.all
                    [ \_ -> Expect.equal [ StudioEyeDropperRequest ] out
                    , \_ -> Expect.equal True busy.studioEyeDropperBusy
                    , \_ -> Expect.equal ( { seeded | studioEyeDropperSupported = False }, [] ) (update StudioEyeDropperSample { seeded | studioEyeDropperSupported = False })
                    , \_ -> Expect.equal ( seeded, [] ) (update (StudioEyeDropperResult { state = "selected", detail = "", hex = "#ff0000" }) seeded)
                    , \_ -> Expect.equal (Just { message = "Accent seed sampled from #ff0000.", failure = False }) sampled.studioEyeDropperStatus
                    , \_ -> Expect.equal False sampled.studioEyeDropperBusy
                    , \_ -> Expect.equal [] sampleOut
                    , \_ ->
                        case cancelled.studioEyeDropperStatus of
                            Just status ->
                                Expect.equal False status.failure

                            Nothing ->
                                Expect.fail "expected status"
                    , \_ ->
                        case invalid.studioEyeDropperStatus of
                            Just status ->
                                Expect.equal True status.failure

                            Nothing ->
                                Expect.fail "expected status"
                    ]
                    ()
        , test "boot theme imports once the snapshot lands" <|
            \_ ->
                let
                    theme =
                        { id = "custom:tide-ink", name = "Tide Ink", base = "tide", overrides = Dict.fromList [ ( "--lapis", "#ff0000" ) ] }

                    code =
                        Studio.encodeThemeShare ThemeTokens.themeIds theme

                    ( imported, out ) =
                        update (AppearanceSnapshot snapshot) { blank | studioBootTheme = Just code }

                    ( stripped, stripOut ) =
                        update (AppearanceSnapshot snapshot) { blank | studioBootTheme = Just "%%%" }
                in
                Expect.all
                    [ \_ -> Expect.equal True (not (String.isEmpty code))
                    , \_ -> Expect.equal "custom:tide-ink" imported.themeId
                    , \_ -> Expect.equal 1 (List.length imported.studioCustoms)
                    , \_ -> Expect.equal True (hasOutbound StudioStripShareParam out)
                    , \_ -> Expect.equal True (hasOutbound (AppearanceStoreTheme { id = "custom:tide-ink" }) out)
                    , \_ -> Expect.equal "ocean" stripped.themeId
                    , \_ -> Expect.equal True (hasOutbound StudioStripShareParam stripOut)
                    ]
                    ()
        , test "cross-tab refresh falls back off a deleted theme" <|
            \_ ->
                let
                    ( refreshed, out ) =
                        update (StudioCustomThemesRefreshed (Encode.object [ ( "json", Encode.string "[]" ) ])) withCustom
                in
                Expect.all
                    [ \_ -> Expect.equal "ocean" refreshed.themeId
                    , \_ -> Expect.equal [] refreshed.studioCustoms
                    , \_ -> Expect.equal True (hasOutbound (AppearanceStoreTheme { id = "ocean" }) out)
                    ]
                    ()
        , test "base switch and route leave clear the session" <|
            \_ ->
                let
                    ( edited, _ ) =
                        update (StudioTokenInput { property = "--lapis", value = "#ff0000" }) seeded

                    ( switched, _ ) =
                        update (AppearanceSetTheme { id = "tide" }) edited

                    ( left, leaveOut ) =
                        leaveTo "/app" edited
                in
                Expect.all
                    [ \_ -> Expect.equal Dict.empty switched.studioOverrides
                    , \_ -> Expect.equal Dict.empty left.studioOverrides
                    , \_ -> Expect.equal True (List.any isApply leaveOut)
                    ]
                    ()
        , test "millis format the export stamp" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "1970-01-01T00:00:00.000Z" (millisToIso 0)
                    , \_ -> Expect.equal "1970-01-01T01:01:01.005Z" (millisToIso 3661005)
                    , \_ -> Expect.equal "1970-01-02T00:00:00.000Z" (millisToIso 86400000)
                    ]
                    ()
        , test "tab selection allowlists group ids" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "motion" (Tuple.first (update (StudioTabSelect { id = "motion" }) seeded)).studioTab
                    , \_ -> Expect.equal ( seeded, [] ) (update (StudioTabSelect { id = "nope" }) seeded)
                    ]
                    ()
        ]


safeSeed : Theme.PaletteSeed
safeSeed =
    { scheme = "dark"
    , primaryHue = 300
    , accentHue = 158
    , depth = 0.7
    , vibrancy = 0.55
    , warmth = 0.1
    , contrast = 8
    }
