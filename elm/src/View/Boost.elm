module View.Boost exposing (jumpToDateSheet)

{-| Jump-to-date sheet (slice `boost`, roadmap 2.6): the discoverable
time-travel control mirroring `src/shell/JumpToDateSheet.tsx`.

Same copy, aria names, and `data-testid`s as the oracle; submitting
reuses the existing `requestTravelTo` fold (vault-around first, then
`CHATHISTORY AROUND`), so no new wire paths are introduced. The sheet
is a light-dismiss dialog: backdrop click, Escape, and the close
button all send `JumpToDateClose`.

-}

import App exposing (Model, Msg(..))
import Boost
import Html exposing (Html, a, button, div, h2, input, label, p, text)
import Html.Attributes exposing (attribute, class, disabled, for, href, id, type_, value)
import Html.Events exposing (on, onClick, onInput)
import View.Icon exposing (icon)
import Json.Decode as Decode
import Set
import View.Sheet as Sheet


{-| The sheet renders only while `showJumpToDate` is set. -}
jumpToDateSheet : Model -> Html Msg
jumpToDateSheet model =
    if not model.showJumpToDate then
        text ""

    else
        Sheet.view
            { scope = "jump-to-date"
            , label = Sheet.Labelled "Jump to date"
            , onClose = JumpToDateClose
            , placement = Sheet.Center
            , layerClass = ""
            , panelClass = "jump-to-date-sheet"
            , backdropClass = "onyx-jump-backdrop"
            , layerAttrs = []
            , modal = True
            , attrs = []
            }
                [ div [ class "jump-to-date-head" ]
                    [ h2 [ class "jump-to-date-title" ] [ text "Jump to date" ]
                    , button
                        [ type_ "button"
                        , class "jump-to-date-close"
                        , attribute "aria-label" "Close jump to date"
                        , onClick JumpToDateClose
                        ]
                        [ icon "x" ]
                    ]
                , div [ class "jump-to-date", attribute "data-testid" "jump-to-date-sheet" ]
                    [ sheetBody model ]
                ]


sheetBody : Model -> Html Msg
sheetBody model =
    case model.activeChannel of
        Nothing ->
            p [ class "jump-to-date__empty", attribute "role" "status" ]
                [ text "Open a room or direct message first, then choose when to view its messages." ]

        Just channel ->
            div []
                ([ p [ class "jump-to-date__description" ]
                    [ text ("Choose a date and time to view messages in " ++ targetLabel channel ++ ". Times are entered in UTC.") ]
                 ]
                    ++ offlineNotice model
                    ++ loadingNotice model channel
                    ++ [ presetsRow
                       , fieldsRow model channel
                       ]
                    ++ validationNote model
                    ++ errorAlert model
                    ++ [ actionsRow model channel ]
                )


{-| `@nick` for DMs, the bare name for channels (mirroring the oracle
`targetLabel`; channel detection follows the pins drawer `#`/`&`
rule). -}
targetLabel : String -> String
targetLabel channel =
    if isLedgerChannel channel then
        channel

    else
        "@" ++ channel


isLedgerChannel : String -> Bool
isLedgerChannel channel =
    case String.uncons (String.trim channel) of
        Just ( first, _ ) ->
            first == '#' || first == '&'

        Nothing ->
            False


offlineNotice : Model -> List (Html Msg)
offlineNotice model =
    if model.connection == App.Live then
        []

    else
        [ p [ class "jump-to-date__notice", attribute "role" "status" ]
            [ text "History is unavailable while you are offline. Reconnect to continue." ]
        ]


loadingNotice : Model -> String -> List (Html Msg)
loadingNotice model channel =
    if Set.member (String.toLower channel) model.historyLoading then
        [ p [ class "jump-to-date__notice", attribute "role" "status", attribute "aria-live" "polite" ]
            [ text "Loading messages around this moment…" ]
        ]

    else
        []


presetsRow : Html Msg
presetsRow =
    div [ class "jump-to-date__presets", attribute "role" "group", attribute "aria-label" "Quick dates" ]
        (List.map
            (\preset ->
                button
                    [ type_ "button"
                    , class "jump-to-date__preset"
                    , onClick (JumpToDatePreset preset.daysAgo)
                    ]
                    [ text preset.label ]
            )
            Boost.jumpPresets
        )


fieldsRow : Model -> String -> Html Msg
fieldsRow model channel =
    div [ class "jump-to-date__fields" ]
        [ div [ class "jump-to-date__field" ]
            [ label [ for "jump-to-date-date" ] [ text "Date" ]
            , input
                [ type_ "date"
                , id "jump-to-date-date"
                , value model.jumpDate
                , attribute "data-jump-to-date-input" ""
                , onInput JumpToDateInputDate
                ]
                []
            , p [ class "jump-to-date__hint" ]
                [ text ("View messages in " ++ channel ++ ". Date uses UTC.") ]
            ]
        , div [ class "jump-to-date__field" ]
            [ label [ for "jump-to-date-time" ] [ text "Time" ]
            , input
                [ type_ "time"
                , id "jump-to-date-time"
                , value model.jumpTime
                , onInput JumpToDateInputTime
                ]
                []
            , p [ class "jump-to-date__hint" ]
                [ text "Uses UTC. Defaults to noon when you choose a quick date." ]
            ]
        ]


resolvedMoment : Model -> Maybe Float
resolvedMoment model =
    Boost.dateTimeAtUtc model.jumpDate model.jumpTime


{-| Inline validation copy (mirrors the oracle `validationMessage`;
the submit fold reports the same string through `jumpError`). -}
validationNote : Model -> List (Html Msg)
validationNote model =
    case resolvedMoment model of
        Just _ ->
            []

        Nothing ->
            [ p [ class "jump-to-date__error" ] [ text "Enter a valid UTC date and time." ] ]


{-| Fold-reported errors surface as an alert only once the fields
resolve (mirroring the oracle `error() && resolvedAt()` gate). -}
errorAlert : Model -> List (Html Msg)
errorAlert model =
    case ( model.jumpError, resolvedMoment model ) of
        ( Just message, Just _ ) ->
            [ p [ class "jump-to-date__error", attribute "role" "alert" ] [ text message ] ]

        _ ->
            []


jumpBlocked : Model -> String -> Bool
jumpBlocked model channel =
    resolvedMoment model
        == Nothing
        || model.connection
        /= App.Live
        || Set.member (String.toLower channel) model.historyLoading


actionsRow : Model -> String -> Html Msg
actionsRow model channel =
    let
        blocked =
            jumpBlocked model channel

        loading =
            Set.member (String.toLower channel) model.historyLoading
    in
    div [ class "jump-to-date__actions" ]
        ([ button
            [ type_ "button"
            , class "jump-to-date__jump"
            , attribute "aria-busy"
                (if loading then
                    "true"

                 else
                    "false"
                )
            , disabled blocked
            , onClick JumpToDateSubmit
            ]
            [ text "View messages" ]
         , button
            [ type_ "button"
            , class "jump-to-date__copy"
            , attribute "aria-label" ("Copy moment link for " ++ channel)
            , disabled blocked
            , onClick JumpToDateCopyMoment
            ]
            [ text "Copy moment link" ]
         ]
            ++ (if isLedgerChannel channel then
                    [ a
                        [ class "jump-to-date__ledger"
                        , href (App.statsRoomHref channel)
                        , attribute "aria-label" ("Room ledger for " ++ channel)
                        ]
                        [ text "Room ledger" ]
                    ]

                else
                    []
               )
        )

