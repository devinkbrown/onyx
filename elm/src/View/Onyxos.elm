module View.Onyxos exposing (OnyxosStage, methodPanelId, methodTabId, onyxosStages, route, stageById, view)

{-| OnyxOS product page, mirroring `src/routes/OnyxOS.tsx`: section
nav, hero, native grid, the tabbed method explorer, the source
specimen, the workbench commands, and the close — inside the public
frame with the "Native work" context line.

The tab fold lives in `App` (`onyxosStage`, `SelectOnyxosStage`,
`OnyxosStageKey` with wraparound + Home/End, mirroring
`onTabKeyDown`). Moving DOM focus onto the newly selected tab is a
DOM behaviour with no pure equivalent and stays a documented
narrowing; roving `tabindex` and `aria-selected` still fold purely.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, article, br, button, code, dd, div, dl, dt, em, figcaption, figure, h1, h2, h3, nav, p, pre, section, small, span, text, ul, li)
import Html.Attributes exposing (attribute, class, href, id, tabindex, type_)
import Html.Events exposing (onClick, preventDefaultOn)
import Json.Decode as Decode
import View.PublicFrame exposing (frame)


{-| One compatibility-method stage. -}
type alias OnyxosStage =
    { id : String
    , label : String
    , signal : String
    , title : String
    , body : String
    , checks : List String
    }


{-| The method stages, mirroring `stages`. -}
onyxosStages : List OnyxosStage
onyxosStages =
    [ { id = "oracle"
      , label = "01 · Oracle"
      , signal = "native behavior first"
      , title = "Read the machine that already works."
      , body = "Compatibility begins with a named Windows behavior and its exact binary evidence—not a guessed API shape. The point is to preserve contracts that programs can actually observe."
      , checks = [ "Targeted function recovery", "Binary identity recorded", "ABI and lifecycle reviewed" ]
      }
    , { id = "implementation"
      , label = "02 · Clean room"
      , signal = "source with provenance"
      , title = "Write only what the evidence can support."
      , body = "OnyxOS implementations stay source-owned and clean-room. Each new behavior is wired deliberately into the product graph instead of being left as a convincing but unreachable draft."
      , checks = [ "One source owner", "Meson graph wiring", "No invented private protocol" ]
      }
    , { id = "gate"
      , label = "03 · Gate"
      , signal = "links or it is not done"
      , title = "A green report is not a shipped binary."
      , body = "The compatibility gate is a real target link. It rejects a wave that merely looks complete on paper and keeps implementation, wiring, and exported behavior accountable to the same build."
      , checks = [ "Deterministic source manifest", "Strict target link", "No skipped integration step" ]
      }
    , { id = "boot"
      , label = "04 · Boot"
      , signal = "the guest is the witness"
      , title = "Let the operating system answer back."
      , body = "A real boot is the final conversation: firmware, kernel, services, logon, and applications expose the seams that static analysis cannot. Failures become the next evidence-backed slice."
      , checks = [ "Instrumented boot path", "Guest fault classification", "Evidence feeds the next wave" ]
      }
    ]


{-| The published source excerpt, mirroring `sourcePreview`. -}
sourcePreview : String
sourcePreview =
    """NTSTATUS
NTAPI
OnyxSaferWriteEventLogEntry(
    _In_ ULONG NtStatusCode,
    _In_opt_ PCWSTR TargetPath,
    _In_opt_ const GUID *LevelGuid,
    _In_opt_ PVOID Extra)
{
    EVENT_DATA_DESCRIPTOR Data[3] = {{0}};
    PCEVENT_DESCRIPTOR Descriptor;
    ULONG Count;
    NTSTATUS Status = STATUS_SUCCESS;

    OnyxSaferEnterCs();
    if (OnyxSaferEtwRegHandle == 0)
        Status = (NTSTATUS)EtwEventRegister(&OnyxSaferEtwProviderGuid, NULL,
                                            NULL, &OnyxSaferEtwRegHandle);
    OnyxSaferLeaveCs();"""


{-| Stable tabpanel id, referenced by every stage tab. -}
methodPanelId : String
methodPanelId =
    "onyxos-method-panel"


{-| Stable per-tab id so the panel can name its selected tab. -}
methodTabId : String -> String
methodTabId stage =
    "onyxos-method-tab-" ++ stage


{-| Active stage with the oracle's first-stage fallback. -}
stageById : String -> OnyxosStage
stageById id =
    List.filter (\stage -> stage.id == id) onyxosStages
        |> List.head
        |> Maybe.withDefault
            { id = "oracle"
            , label = ""
            , signal = ""
            , title = ""
            , body = ""
            , checks = []
            }


{-| Roving tab keys: handled keys select and prevent default (like
the oracle's `preventDefault`); anything else keeps native behavior. -}
onStageKey : Html.Attribute Msg
onStageKey =
    preventDefaultOn "keydown"
        (Decode.field "key" Decode.string
            |> Decode.andThen
                (\key ->
                    case key of
                        "ArrowRight" ->
                            Decode.succeed ( OnyxosStageKey { key = key }, True )

                        "ArrowDown" ->
                            Decode.succeed ( OnyxosStageKey { key = key }, True )

                        "ArrowLeft" ->
                            Decode.succeed ( OnyxosStageKey { key = key }, True )

                        "ArrowUp" ->
                            Decode.succeed ( OnyxosStageKey { key = key }, True )

                        "Home" ->
                            Decode.succeed ( OnyxosStageKey { key = key }, True )

                        "End" ->
                            Decode.succeed ( OnyxosStageKey { key = key }, True )

                        _ ->
                            Decode.fail "unhandled key keeps native behavior"
                )
        )


stageTab : String -> OnyxosStage -> Html Msg
stageTab selected stage =
    let
        active =
            selected == stage.id
    in
    button
        [ type_ "button"
        , attribute "role" "tab"
        , id (methodTabId stage.id)
        , attribute "aria-selected" (if active then "true" else "false")
        , attribute "aria-controls" methodPanelId
        , tabindex (if active then 0 else -1)
        , class (if active then "is-active" else "")
        , onClick (SelectOnyxosStage { stage = stage.id })
        , onStageKey
        ]
        [ span [] [ text stage.label ]
        , small [] [ text stage.signal ]
        ]


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "Native work" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Evidence-led system engineering" ]
        ]


{-| The OnyxOS body. `selected` is the active method stage id. -}
view : String -> Html Msg
view selected =
    let
        active =
            stageById selected
    in
    div [ class "onyxos-page" ]
        [ div [ class "onyxos-grid", attribute "aria-hidden" "true" ] []
        , nav [ class "onyxos-sections", attribute "aria-label" "OnyxOS sections" ]
            [ a [ href "#onyx-native" ] [ text "Onyx" ]
            , a [ href "#method" ] [ text "Method" ]
            , a [ href "#source" ] [ text "Source" ]
            , a [ href "#workbench" ] [ text "Workbench" ]
            ]
        , section [ class "onyxos-hero", attribute "aria-labelledby" "onyxos-title" ]
            [ p [ class "onyxos-eyebrow" ] [ text "Onyx + OnyxOS · one product family" ]
            , h1 [ id "onyxos-title" ] [ text "Communication,", br [] [], em [] [ text "at home in the system." ] ]
            , p [ class "onyxos-lede" ] [ text "Onyx is being designed as a first-class native experience in OnyxOS—identity, notifications, protected local history, calls, and accessibility working with the operating system instead of sitting on top of it." ]
            , div [ class "onyxos-hero__actions" ]
                [ a [ class "onyxos-button", href "/app/" ] [ text "Use Onyx in browser ", span [ attribute "aria-hidden" "true" ] [ text "→" ] ]
                , a [ class "onyxos-button", href "#onyx-native" ] [ text "See the native plan" ]
                ]
            , p [ class "onyxos-proof", attribute "role" "note" ]
                [ span [ attribute "aria-hidden" "true" ] [ text "◆" ]
                , text " Onyx stays cross-platform. OnyxOS makes it exceptional."
                ]
            ]
        , section [ class "onyxos-native", id "onyx-native", attribute "aria-labelledby" "onyxos-native-title" ]
            [ div [ class "onyxos-section-heading" ]
                [ p [ class "onyxos-eyebrow" ] [ text "the native communication layer" ]
                , h2 [ id "onyxos-native-title" ] [ text "The same Onyx. Deeper system roots." ]
                , p [] [ text "Every native enhancement keeps a web fallback and an explicit permission boundary. OnyxOS is the flagship home, not a lock-in requirement." ]
                ]
            , div [ class "onyxos-native__grid" ]
                [ article [] [ span [] [ text "01" ], h3 [] [ text "Identity" ], p [] [ text "System-protected credentials, device continuity, and recovery without inventing a second account." ] ]
                , article [] [ span [] [ text "02" ], h3 [] [ text "Attention" ], p [] [ text "Native notifications, quiet modes, call surfaces, and catch-up that respect system focus." ] ]
                , article [] [ span [] [ text "03" ], h3 [] [ text "Memory" ], p [] [ text "An OS-protected local vault, deliberate backup policy, fast search, and portable export." ] ]
                , article [] [ span [] [ text "04" ], h3 [] [ text "Media" ], p [] [ text "System device routing, screen sharing, captions, and the exact protection state shown in every call." ] ]
                ]
            ]
        , section [ class "onyxos-method", id "method", attribute "aria-labelledby" "onyxos-method-title" ]
            [ div [ class "onyxos-section-heading" ]
                [ p [ class "onyxos-eyebrow" ] [ text "the method" ]
                , h2 [ id "onyxos-method-title" ] [ text "Choose a signal. Follow it all the way through." ]
                ]
            , div [ class "onyxos-console", attribute "aria-label" "OnyxOS compatibility method explorer" ]
                [ div [ class "onyxos-console__tabs", attribute "role" "tablist", attribute "aria-label" "Compatibility stages" ]
                    (List.map (stageTab selected) onyxosStages)
                , article [ class "onyxos-console__body", id methodPanelId, attribute "role" "tabpanel", attribute "aria-labelledby" (methodTabId active.id), tabindex 0 ]
                    [ p [ class "onyxos-console__signal" ] [ text active.signal ]
                    , h3 [] [ text active.title ]
                    , p [] [ text active.body ]
                    , ul [] (List.map (\check -> li [] [ span [ attribute "aria-hidden" "true" ] [ text "↳" ], text check ]) active.checks)
                    ]
                ]
            ]
        , section [ class "onyxos-source", id "source", attribute "aria-labelledby" "onyxos-source-title" ]
            [ div [ class "onyxos-source__intro" ]
                [ p [ class "onyxos-eyebrow" ] [ text "source specimen · advapi32" ]
                , h2 [ id "onyxos-source-title" ] [ text "This is real OnyxOS code." ]
                , p [] [ text "The full 290-line clean-room implementation is published exactly as it builds in the working tree. It reconstructs the Windows 11 Safer event-log path, including ETW registration, descriptor selection, buffer sizing, and failure propagation." ]
                , dl [ class "onyxos-source__facts" ]
                    [ div [] [ dt [] [ text "Language" ], dd [] [ text "C" ] ]
                    , div [] [ dt [] [ text "Subsystem" ], dd [] [ text "Advapi32 · Safer" ] ]
                    , div [] [ dt [] [ text "Status" ], dd [] [ text "Active integration" ] ]
                    ]
                , a [ class "onyxos-button onyxos-button--primary", href "/source/onyxos/safer_record_event_log_entry.c" ] [ text "Open the full source ", span [ attribute "aria-hidden" "true" ] [ text "→" ] ]
                ]
            , figure [ class "onyxos-source__sheet" ]
                [ figcaption [] [ span [] [ text "safer_record_event_log_entry.c" ], span [] [ text "excerpt" ] ]
                , pre [ tabindex 0 ] [ code [] [ text sourcePreview ] ]
                ]
            ]
        , section [ class "onyxos-workbench", id "workbench", attribute "aria-labelledby" "onyxos-workbench-title" ]
            [ div []
                [ p [ class "onyxos-eyebrow" ] [ text "the public workbench" ]
                , h2 [ id "onyxos-workbench-title" ] [ text "A site should be as inspectable as the system it describes." ]
                , p [] [ text "This page is statically delivered, route-aware, and designed to remain useful before any JavaScript loads. The local workbench keeps preview, quality gates, and production deployment separate on purpose." ]
                ]
            , div [ class "onyxos-command", attribute "aria-label" "Local website commands" ]
                [ p [] [ span [] [ text "$" ], text " pnpm site:workbench" ]
                , p [ class "onyxos-command__muted" ] [ text "interactive local preview · quality gates · deploy-plan inspection" ]
                , p [] [ span [] [ text "$" ], text " pnpm site:check" ]
                , p [ class "onyxos-command__muted" ] [ text "typecheck · lint · tests · production build to dist/" ]
                ]
            ]
        , section [ class "onyxos-close", attribute "aria-labelledby" "onyxos-close-title" ]
            [ p [ class "onyxos-eyebrow" ] [ text "one product, every platform" ]
            , h2 [ id "onyxos-close-title" ] [ text "Use Onyx now.", br [] [], text "Meet its native home." ]
            , a [ class "onyxos-button onyxos-button--primary", href "/roadmap/" ] [ text "See the product roadmap ", span [ attribute "aria-hidden" "true" ] [ text "→" ] ]
            ]
        ]


{-| The OnyxOS route inside the public frame. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/onyxos/" "OnyxOS and Onyx" (Just contextLine) [ view model.onyxosStage ] ]
