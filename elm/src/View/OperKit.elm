module View.OperKit exposing
    ( button_
    , card
    , choice
    , clockHms
    , consoleMsg
    , disclosure
    , emptyNote
    , field
    , formRow
    , lede
    , listingMeta
    , repliesLog
    , reviewBlock
    , selectInput
    , textInput
    , toneAttr
    )

{-| v3/gap-oper — the small set of pieces every operator tab is built
from, so the tabs read as one calm surface: a lede, cards, labelled
fields, one review block for anything that changes the network, and the
reply log that keeps the daemon's answers in the desk.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, button, code, details, div, h3, input, label, li, option, p, section, select, span, summary, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, placeholder, selected, type_, value)
import Html.Events exposing (onClick, onInput)
import OperConsole
import OperPlan
import OperReply exposing (Section, Tone(..))
import Time


consoleMsg : OperConsole.Msg -> Msg
consoleMsg =
    OperConsoleMsg


lede : String -> Html Msg
lede copy =
    p [ class "oc-lede" ] [ text copy ]


card : { id : String, title : String, hint : String } -> List (Html Msg) -> Html Msg
card config body =
    section
        [ class "oc-card"
        , attribute "aria-labelledby" ("oc-card-" ++ config.id)
        , attribute "data-testid" ("oc-card-" ++ config.id)
        ]
        (div [ class "oc-card-head" ]
            [ h3 [ id ("oc-card-" ++ config.id) ] [ text config.title ]
            , if config.hint == "" then
                text ""

              else
                p [ class "oc-hint" ] [ text config.hint ]
            ]
            :: body
        )


{-| Progressive disclosure: a quiet summary row that opens a card's
less-used controls. -}
disclosure : { id : String, title : String, hint : String, open : Bool } -> List (Html Msg) -> Html Msg
disclosure config body =
    details
        [ class "oc-more"
        , attribute "data-testid" ("oc-more-" ++ config.id)
        , if config.open then
            attribute "open" ""

          else
            class "oc-more-closed"
        ]
        (summary []
            [ span [ class "oc-more-title" ] [ text config.title ]
            , if config.hint == "" then
                text ""

              else
                span [ class "oc-more-hint" ] [ text config.hint ]
            ]
            :: body
        )


field : { id : String, label : String, hint : String } -> Html Msg -> Html Msg
field config control =
    div [ class "oc-field" ]
        [ label [ for config.id ] [ text config.label ]
        , control
        , if config.hint == "" then
            text ""

          else
            p [ class "oc-hint", attribute "id" (config.id ++ "-hint") ] [ text config.hint ]
        ]


textInput :
    { id : String
    , value : String
    , placeholder : String
    , onChange : String -> Msg
    , testId : String
    , mono : Bool
    , max : Int
    }
    -> Html Msg
textInput config =
    input
        [ id config.id
        , type_ "text"
        , class
            (if config.mono then
                "oc-input oc-input-mono"

             else
                "oc-input"
            )
        , value config.value
        , placeholder config.placeholder
        , maxlength config.max
        , attribute "autocomplete" "off"
        , attribute "autocapitalize" "off"
        , attribute "autocorrect" "off"
        , attribute "spellcheck" "false"
        , attribute "data-testid" config.testId
        , attribute "aria-describedby" (config.id ++ "-hint")
        , onInput config.onChange
        ]
        []


selectInput :
    { id : String
    , value : String
    , options : List ( String, String )
    , onChange : String -> Msg
    , testId : String
    }
    -> Html Msg
selectInput config =
    select
        [ id config.id
        , class "oc-input"
        , attribute "data-testid" config.testId
        , onInput config.onChange
        ]
        (List.map
            (\( val, name ) -> option [ value val, selected (val == config.value) ] [ text name ])
            config.options
        )


{-| `kind` is "primary" (the accent), "danger", or "quiet". -}
button_ :
    { kind : String
    , label : String
    , testId : String
    , onClick : Msg
    , disabled : Bool
    , ariaLabel : Maybe String
    }
    -> Html Msg
button_ config =
    button
        ([ type_ "button"
         , class ("oc-btn oc-btn-" ++ config.kind)
         , disabled config.disabled
         , attribute "data-testid" config.testId
         , onClick config.onClick
         ]
            ++ (case config.ariaLabel of
                    Just name ->
                        [ attribute "aria-label" name ]

                    Nothing ->
                        []
               )
        )
        [ text config.label ]


{-| A row of controls that wraps. -}
formRow : List (Html Msg) -> Html Msg
formRow children =
    div [ class "oc-row" ] children


{-| A two-or-more-way pressed-state chooser (segmented). -}
choice : { label : String, testId : String, current : String, options : List ( String, String ), onPick : String -> Msg } -> Html Msg
choice config =
    div [ class "oc-seg", attribute "role" "group", attribute "aria-label" config.label, attribute "data-testid" config.testId ]
        (List.map
            (\( val, name ) ->
                button
                    [ type_ "button"
                    , class "oc-seg-btn"
                    , attribute "aria-pressed"
                        (if val == config.current then
                            "true"

                         else
                            "false"
                        )
                    , onClick (config.onPick val)
                    ]
                    [ text name ]
            )
            config.options
        )


emptyNote : String -> Html Msg
emptyNote copy =
    p [ class "oc-empty", attribute "role" "status" ] [ text copy ]


toneAttr : Tone -> String
toneAttr tone =
    case tone of
        Plain ->
            "plain"

        Good ->
            "good"

        Warn ->
            "warn"

        Bad ->
            "bad"


{-| What is staged. Nothing here sends: the confirm button does. -}
reviewBlock : Bool -> OperPlan.Command -> Html Msg
reviewBlock live command =
    div
        [ class
            (if command.destructive then
                "oc-review oc-review-danger"

             else
                "oc-review"
            )
        , attribute "role" "alertdialog"
        , attribute "aria-label" "Review before sending"
        , attribute "data-testid" "oc-review"
        ]
        [ p [ class "oc-review-summary", attribute "data-testid" "oc-review-summary" ] [ text command.summary ]
        , code [ class "oc-wire", attribute "data-testid" "oc-review-wire" ] [ text (OperPlan.preview command) ]
        , div [ class "oc-row" ]
            [ button
                [ type_ "button"
                , id "oc-review-confirm"
                , class
                    (if command.destructive then
                        "oc-btn oc-btn-danger"

                     else
                        "oc-btn oc-btn-primary"
                    )
                , disabled (not live)
                , attribute "data-testid" "oc-review-confirm"
                , onClick (consoleMsg OperConsole.Confirm)
                ]
                [ text "Send it" ]
            , button
                [ type_ "button"
                , class "oc-btn oc-btn-quiet"
                , attribute "data-testid" "oc-review-cancel"
                , onClick (consoleMsg OperConsole.Cancel)
                ]
                [ text "Cancel" ]
            ]
        ]


{-| The daemon's answers for one tab, newest first, so a command's reply
is never lost in the invisible service log. -}
repliesLog : Model -> Section -> Html Msg
repliesLog model section =
    let
        lines =
            List.take 6 (OperConsole.sectionLog section model.operConsole)
    in
    if List.isEmpty lines then
        text ""

    else
        div [ class "oc-replies", attribute "data-testid" "oc-replies" ]
            [ div [ class "oc-replies-head" ]
                [ span [ class "oc-replies-title" ] [ text "Replies" ]
                , button
                    [ type_ "button"
                    , class "oc-btn oc-btn-quiet oc-btn-small"
                    , attribute "data-testid" "oc-replies-clear"
                    , onClick (consoleMsg (OperConsole.ClearLog section))
                    ]
                    [ text "Clear" ]
                ]
            , ul [ class "oc-replies-list", attribute "aria-live" "polite", attribute "aria-label" "Replies from the server" ]
                (List.map
                    (\line ->
                        li [ class "oc-reply", attribute "data-tone" (toneAttr line.tone) ]
                            [ span [ class "oc-reply-time" ] [ text (clockHms model.zone line.atMs) ]
                            , span [ class "oc-reply-text" ] [ text line.text ]
                            ]
                    )
                    lines
                )
            ]


{-| `Updated 12:04 · 3 rows`, or `Updating…`. -}
listingMeta : Model -> OperConsole.Listing a -> Html Msg
listingMeta model listing =
    p [ class "oc-meta", attribute "role" "status" ]
        [ text
            (if listing.loading then
                "Updating…"

             else
                case listing.loadedAtMs of
                    Just at ->
                        "Updated " ++ clockHms model.zone at ++ " · " ++ String.fromInt (List.length listing.rows) ++ countWord (List.length listing.rows)

                    Nothing ->
                        "Not loaded yet."
            )
        ]


countWord : Int -> String
countWord n =
    if n == 1 then
        " row"

    else
        " rows"


{-| `HH:MM:SS` in the viewer's zone (24-hour: an event log reads best
with seconds and no am/pm). -}
clockHms : Time.Zone -> Float -> String
clockHms zone ms =
    let
        posix =
            Time.millisToPosix (floor ms)

        pad n =
            String.padLeft 2 '0' (String.fromInt n)
    in
    pad (Time.toHour zone posix) ++ ":" ++ pad (Time.toMinute zone posix) ++ ":" ++ pad (Time.toSecond zone posix)
