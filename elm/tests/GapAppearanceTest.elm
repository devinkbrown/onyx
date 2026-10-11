module GapAppearanceTest exposing (suite)

{-| v3/gap-appearance — the shell palette rides the appearance commit,
the background renderer is told exactly when its scene changes, and the
Preferences sheet edits text size, density, width, reactions, room
tools and blocked link hosts (all through the shared appearance fold).
-}

import App exposing (..)
import Dict
import Expect
import Html
import Html.Attributes
import Json.Encode as Encode
import Prefs
import PrefsPanel exposing (Category(..))
import Route
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


snapshotOf : String -> String -> String -> String -> Encode.Value
snapshotOf prefsJson motion themeId backgroundId =
    Encode.object
        [ ( "prefsJson", Encode.string prefsJson )
        , ( "legacyContrast", Encode.string "" )
        , ( "sceneMotion", Encode.string motion )
        , ( "themeId", Encode.string themeId )
        , ( "backgroundId", Encode.string backgroundId )
        , ( "customThemesJson", Encode.string "[]" )
        ]


boot : String -> ( Model, List Outbound )
boot themeId =
    update (AppearanceSnapshot (snapshotOf (Prefs.encodePreferences Prefs.defaultPreferences) "adaptive" themeId "")) blank


booted : String -> Model
booted themeId =
    Tuple.first (boot themeId)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


scenes : List Outbound -> List SceneSpec
scenes =
    List.filterMap
        (\out ->
            case out of
                BackgroundScene spec ->
                    Just spec

                _ ->
                    Nothing
        )


applied : List Outbound -> List (List ( String, String ))
applied =
    List.filterMap
        (\out ->
            case out of
                AppearanceApply req ->
                    Just req.tokens

                _ ->
                    Nothing
        )


tokenOf : String -> List ( String, String ) -> Maybe String
tokenOf name pairs =
    Dict.get name (Dict.fromList pairs)


attr : String -> String -> Html.Attribute msg
attr =
    Html.Attributes.attribute


sheet : Model -> Query.Single Msg
sheet model =
    View.view { model | prefsOpen = True }
        |> .body
        |> Html.div []
        |> Query.fromHtml
        |> Query.find [ Selector.attribute (attr "data-testid" "preferences-panel") ]


suite : Test
suite =
    describe "gap-appearance"
        [ describe "shell palette commit"
            [ test "the boot apply carries the derived shell palette (Ocean = house)" <|
                \_ ->
                    case applied (Tuple.second (boot "ocean")) of
                        [ tokens ] ->
                            Expect.all
                                [ \t -> Expect.equal (Just "#0b0e12") (tokenOf "--onyx-theme-bg" t)
                                , \t -> Expect.equal (Just "#46c08a") (tokenOf "--onyx-theme-accent" t)
                                , \t -> Expect.notEqual Nothing (tokenOf "--onyx-theme-hc-line" t)
                                , \t -> Expect.equal (Just "#202429") (tokenOf "--ink" t)
                                ]
                                tokens

                        other ->
                            Expect.fail ("expected one apply, got " ++ String.fromInt (List.length other))
            , test "a light look commits a light shell" <|
                \_ ->
                    case applied (Tuple.second (boot "pearl")) of
                        [ tokens ] ->
                            Expect.equal (Just "#f5f0e5") (tokenOf "--onyx-theme-bg" tokens)

                        _ ->
                            Expect.fail "expected one apply"
            , test "switching looks re-commits the shell" <|
                \_ ->
                    let
                        ( _, out ) =
                            update (AppearanceSetTheme { id = "frost" }) (booted "ocean")
                    in
                    Expect.equal [ Just "#e3f7fe" ] (List.map (tokenOf "--onyx-theme-bg") (applied out))
            , test "a Theme Studio session edit recolors the matching shell slot" <|
                \_ ->
                    let
                        model =
                            booted "ocean"

                        edited =
                            { model | studioOverrides = Dict.fromList [ ( "--stone", "#2a2f38" ) ] }
                    in
                    Expect.equal (Just "#2a2f38") (tokenOf "--onyx-theme-panel" (shellPaletteCommit edited))
            , test "a saved custom theme anchors on its built-in base" <|
                \_ ->
                    let
                        model =
                            booted "ocean"
                    in
                    Expect.equal (Just "#0b0e12") (tokenOf "--onyx-theme-bg" (shellPaletteCommit { model | themeId = "custom:none" }))
            ]
        , describe "background scene"
            [ test "nothing paints before the stored appearance is read" <|
                \_ -> Expect.equal "none" (sceneSpecFor blank).surface
            , test "the boot snapshot tells the renderer once (app shell, theme signature)" <|
                \_ ->
                    Expect.equal
                        [ { id = "deep-current", motion = "adaptive", reduceMotion = False, surface = "app" } ]
                        (scenes (Tuple.second (boot "ocean")))
            , test "a look with another signature swaps the scene" <|
                \_ ->
                    Expect.equal [ "paper-grain" ]
                        (List.map .id (scenes (Tuple.second (update (AppearanceSetTheme { id = "pearl" }) (booted "ocean")))))
            , test "unrelated changes never re-send the scene" <|
                \_ ->
                    Expect.equal []
                        (scenes (Tuple.second (update (AppearanceSetPref { key = "clock", value = "12h" }) (booted "ocean"))))
            , test "motion and the in-app Reduce motion switch re-send it" <|
                \_ ->
                    Expect.all
                        [ \m -> Expect.equal [ "still" ] (List.map .motion (scenes (Tuple.second (update (PrefsSetSceneMotion "still") m))))
                        , \m -> Expect.equal [ True ] (List.map .reduceMotion (scenes (Tuple.second (update AppearanceToggleReduceMotion m))))
                        ]
                        (booted "ocean")
            , test "public pages tear the scene down" <|
                \_ ->
                    let
                        model =
                            booted "ocean"
                    in
                    Expect.equal "none" (sceneSpecFor { model | route = Route.Landing }).surface
            , test "the Appearance stage paints the staged pick" <|
                \_ ->
                    let
                        model =
                            booted "ocean"

                        staged =
                            step (AppearanceStageBackground { id = "ember" }) { model | route = Route.Appearance }
                    in
                    Expect.equal { id = "ember", motion = "adaptive", reduceMotion = False, surface = "appearance" } (sceneSpecFor staged)
            , test "Escape drops a staged background pick and the scene returns to the saved one" <|
                \_ ->
                    let
                        model =
                            booted "ocean"

                        staged =
                            step (AppearanceStageBackground { id = "ember" }) { model | route = Route.Appearance }

                        ( cancelled, out ) =
                            case escapeMsg staged of
                                Just msg ->
                                    update msg staged

                                Nothing ->
                                    ( staged, [] )
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just AppearanceCancelBackground) (escapeMsg staged)
                        , \_ -> Expect.equal False (backgroundDirty cancelled)
                        , \_ -> Expect.equal "deep-current" (sceneSpecFor cancelled).id
                        , \_ -> Expect.equal [ "deep-current" ] (List.map .id (scenes out))
                        , \_ -> Expect.equal Nothing (escapeMsg cancelled)
                        , \_ -> Expect.equal Nothing (escapeMsg { staged | route = Route.App })
                        ]
                        ()
            ]
        , describe "preferences"
            [ test "the new keys parse and guard like the rest" <|
                \_ ->
                    let
                        d =
                            Prefs.defaultPreferences
                    in
                    Expect.all
                        [ \_ -> Expect.equal False (Prefs.updatePreference d "voiceEntry" "false").voiceEntry
                        , \_ -> Expect.equal False (Prefs.updatePreference d "topicTools" "false").topicTools
                        , \_ -> Expect.equal Prefs.ReactionCountsOnly (Prefs.updatePreference d "reactionDensity" "counts-only").reactionDensity
                        , \_ -> Expect.equal Prefs.ReactionFull (Prefs.updatePreference d "reactionDensity" "loud").reactionDensity
                        , \_ -> Expect.equal [ "example.com", "intranet.local" ] (Prefs.updatePreference d "blockedHosts" " Example.com., https://x/y, intranet.local, example.com").blockedHosts
                        , \_ -> Expect.equal [] (Prefs.updatePreference { d | blockedHosts = [ "a.test" ] } "blockedHosts" "").blockedHosts
                        ]
                        ()
            , test "Display shows Text size, Density and Conversation width" <|
                \_ ->
                    Expect.all
                        [ \q -> q |> Query.find [ Selector.attribute (attr "data-testid" "pref-font-scale") ] |> Query.find [ Selector.attribute (attr "aria-checked" "true") ] |> Query.has [ Selector.text "Medium" ]
                        , \q -> q |> Query.find [ Selector.attribute (attr "data-testid" "pref-density") ] |> Query.find [ Selector.attribute (attr "aria-checked" "true") ] |> Query.has [ Selector.text "Cozy" ]
                        , \q -> q |> Query.find [ Selector.attribute (attr "data-testid" "pref-width") ] |> Query.find [ Selector.attribute (attr "aria-checked" "true") ] |> Query.has [ Selector.text "Measured" ]
                        ]
                        (sheet (booted "ocean"))
            , test "choosing Large stores it and re-applies" <|
                \_ ->
                    sheet (booted "ocean")
                        |> Query.find [ Selector.id "pref-font-scale-lg" ]
                        |> Event.simulate Event.click
                        |> Event.expect (AppearanceSetPref { key = "fontScale", value = "lg" })
            , test "Conversation shows reactions, room tools and blocked hosts" <|
                \_ ->
                    let
                        model =
                            booted "ocean"
                    in
                    Expect.all
                        [ \q -> q |> Query.has [ Selector.attribute (attr "data-testid" "pref-reaction-density") ]
                        , \q -> q |> Query.has [ Selector.attribute (attr "data-testid" "pref-toggle-voiceEntry") ]
                        , \q -> q |> Query.has [ Selector.attribute (attr "data-testid" "pref-toggle-topicTools") ]
                        , \q -> q |> Query.has [ Selector.attribute (attr "data-testid" "pref-blocked-hosts") ]
                        , \q -> q |> Query.has [ Selector.text "No hosts blocked." ]
                        ]
                        (sheet { model | prefsCategory = Conversation })
            , test "the room-tool switches flip through the shared fold" <|
                \_ ->
                    let
                        ( next, out ) =
                            update (PrefsTogglePref "voiceEntry") (booted "ocean")
                    in
                    Expect.all
                        [ \_ -> Expect.equal False next.prefs.voiceEntry
                        , \_ -> Expect.equal 1 (List.length (applied out))
                        , \_ -> Expect.equal False (step (PrefsTogglePref "topicTools") next).prefs.topicTools
                        ]
                        ()
            , test "blocked hosts commit on change and read back normalized" <|
                \_ ->
                    let
                        model =
                            booted "ocean"

                        next =
                            step (AppearanceSetPref { key = "blockedHosts", value = "Ads.Example, tracker.test" }) model
                    in
                    Expect.all
                        [ \m -> Expect.equal [ "ads.example", "tracker.test" ] m.prefs.blockedHosts
                        , \m -> sheet { m | prefsCategory = Conversation } |> Query.has [ Selector.text "Blocking 2 hosts: ads.example, tracker.test." ]
                        ]
                        next
            ]
        ]
