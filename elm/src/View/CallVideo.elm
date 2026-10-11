module View.CallVideo exposing
    ( active
    , qualityPip
    , qualityPrompt
    , stageBody
    , stageView
    , statusSuffix
    , tiles
    )

{-| v3/calls-c4 — C4 quality surfaces and C5 video stage
(`CALLS_DESIGN.md` §2.4 right zone, §2.6, §2.7, §2.13).

  - Quality: the bar's four-bar connection pip (`role="img"`
    "Connection: {label}", the word "Poor" at tier 3) and the
    turn-off-camera prompt strip above the bar.
  - Video: grid (columns by count, pages of 16), spotlight (pinned →
    dominant speaker → self, filmstrip "Other participants") and the
    forced screenshare layout (local or remote share primary, the
    sharer first in the filmstrip, a grid escape on the primary tile).

Tiles render a `<video data-voice-tile="{id}">` placeholder over the
avatar; `ports.js` binds the MediaStream by that id (Elm never touches
streams). Tiles are keyed so a reorder never swaps a bound element.

Narrowings: the native PiP button always reads "Open … in
Picture-in-Picture" (ports toggles; Elm does not track the browser's
PiP element); the ≤4-video-tiles rule at 375px is CSS (later tiles
hide their `<video>` and show the avatar, the stream stays bound).

-}

import App exposing (Model, Msg(..))
import CallMedia exposing (StageView(..), Tile, TileKind(..))
import CallUi
import Dict
import Html exposing (Html, button, div, nav, span, text, video)
import Html.Attributes exposing (attribute, autoplay, class, disabled, title, type_)
import Html.Events exposing (onClick)
import Html.Keyed as Keyed
import Set
import View.CallPresence exposing (callIcon)
-- v3/calls-c11
import View.StageMode


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


displayName : Model -> String -> String
displayName model key =
    let
        fromMembers =
            model.calls.channel
                |> Maybe.andThen (\c -> Dict.get (String.toLower c) model.channels)
                |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
                |> Maybe.map .nick
    in
    case fromMembers of
        Just nick ->
            nick

        Nothing ->
            if String.toLower model.calls.withPeer == String.toLower key then
                model.calls.withPeer

            else
                key


roleOf : Model -> String -> Maybe String
roleOf model key =
    model.calls.channel
        |> Maybe.andThen (\c -> Dict.get (String.toLower c) model.channels)
        |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
        |> Maybe.andThen (\m -> CallUi.roleWord m.modes)


{-| The settled tile order (recomputed so a view of an unsettled model
agrees with `App.settleCallMedia`, which stores the same result).
-}
order : Model -> List String
order model =
    let
        selfKey =
            String.toLower model.ourNick

        speaking =
            Dict.foldl
                (\k p acc ->
                    if p.speaking then
                        k :: acc

                    else
                        acc
                )
                []
                model.callPeers
    in
    CallMedia.reconcileOrder
        { selfKey = selfKey
        , roster = CallUi.callRoster model.media model.calls |> List.map String.toLower
        , dominant = model.callSpeaker.dominant
        , pinned = model.callPinned
        , speaking = Set.union model.media.speaking (Set.fromList speaking)
        }
        model.callTileOrder


tiles : Model -> { people : List Tile, shares : List Tile }
tiles model =
    -- v3/calls-c11: the stage audience never gets tiles
    (\t -> { t | people = List.filter (\tile -> View.StageMode.onStage model tile.key) t.people }) <|
    CallMedia.buildTiles
        { ourNick = model.ourNick
        , order = order model
        , media = model.media
        , peers = model.callPeers
        , local = model.callLocal
        , selfMuted = model.callSelfMuted
        , pinned = model.callPinned
        , displayName = displayName model
        , roleOf = roleOf model
        }


{-| Video mode: any live video, any share, or a video participant
whose camera is off / paused (they still expect a tile).
-}
active : Model -> Bool
active model =
    let
        t =
            tiles model
    in
    not (List.isEmpty t.shares)
        || List.any (\tile -> tile.video || tile.cameraOff || tile.videoPaused) t.people


stageView : Model -> StageView
stageView model =
    CallMedia.resolveView
        { layout = model.callLayout
        , shareId = List.head (tiles model).shares |> Maybe.map .id
        , optOut = model.callShareOptOut
        }


{-| Stage status additions: a live share names its sharer (new copy),
and a Poor tier appends " · Protecting audio".
-}
statusSuffix : Model -> { share : Maybe String, protecting : Bool }
statusSuffix model =
    { share =
        if stageView model == ViewScreenshare then
            List.head (tiles model).shares
                |> Maybe.andThen
                    (\s ->
                        if s.self then
                            Nothing

                        else
                            Just (displayName model s.key ++ " is sharing their screen")
                    )

        else
            Nothing
    , protecting = model.callLocal.tier == Just 3
    }



-- STAGE BODY


stageBody : Model -> Html Msg
stageBody model =
    let
        t =
            tiles model

        selfKey =
            String.toLower model.ourNick
    in
    case stageView model of
        ViewScreenshare ->
            case t.shares of
                share :: otherShares ->
                    let
                        sharer =
                            List.filter (\p -> p.key == share.key) t.people

                        rest =
                            List.filter (\p -> p.key /= share.key) t.people
                    in
                    speakerLayout model share (sharer ++ rest ++ otherShares)

                [] ->
                    grid model t

        ViewSpotlight ->
            let
                primaryKey =
                    CallMedia.spotlightPrimary
                        { pinned = model.callPinned
                        , dominant = model.callSpeaker.dominant
                        , selfKey = selfKey
                        , present = List.map .key t.people
                        }
            in
            case List.filter (\p -> p.key == primaryKey) t.people of
                primary :: _ ->
                    speakerLayout model primary (List.filter (\p -> p.key /= primaryKey) t.people ++ t.shares)

                [] ->
                    grid model t

        ViewGrid ->
            grid model t


grid : Model -> { people : List Tile, shares : List Tile } -> Html Msg
grid model t =
    let
        all =
            t.shares ++ t.people

        count =
            List.length all

        page =
            CallMedia.clampPage count model.callPage

        pages =
            CallMedia.pageCount count

        visible =
            CallMedia.pageSlice page all
    in
    div [ class "onyx-call-video" ]
        [ Keyed.node "div"
            [ class "onyx-call-grid"
            , attribute "data-columns" (String.fromInt (CallMedia.gridColumns count))
            , attribute "data-count" (String.fromInt (List.length visible))
            -- v3/rx-calls: rows let CSS size tiles to the stage height
            , attribute "data-rows" (String.fromInt (ceilDiv (List.length visible) (CallMedia.gridColumns count)))
            , attribute "data-testid" "video-grid"
            ]
            (List.map (\tile -> ( tile.id, tileView model { primary = False, listItem = False } tile )) visible)
        , if pages > 1 then
            nav [ class "onyx-call-pager", attribute "aria-label" "Participant pages", attribute "data-testid" "call-pager" ]
                [ button
                    [ type_ "button"
                    , class "onyx-tile-btn"
                    , attribute "aria-label" "Previous participants page"
                    , disabled (page <= 0)
                    , onClick (CallPageSet (page - 1))
                    ]
                    [ callIcon "chevron-left" ]
                , span [ attribute "aria-live" "polite", attribute "aria-atomic" "true" ] -- v3/calls-c11 a11y pass
                    [ text ("Page " ++ String.fromInt (page + 1) ++ " of " ++ String.fromInt pages) ]
                , button
                    [ type_ "button"
                    , class "onyx-tile-btn"
                    , attribute "aria-label" "Next participants page"
                    , disabled (page >= pages - 1)
                    , onClick (CallPageSet (page + 1))
                    ]
                    [ callIcon "chevron-right" ]
                ]

          else
            text ""
        ]


ceilDiv : Int -> Int -> Int
ceilDiv n d =
    if d <= 0 then
        n

    else
        (n + d - 1) // d


speakerLayout : Model -> Tile -> List Tile -> Html Msg
speakerLayout model primary others =
    div [ class "onyx-call-video onyx-call-speaker" ]
        [ div [ class "onyx-call-primary", attribute "data-testid" "spotlight-primary" ]
            [ tileView model { primary = True, listItem = False } primary ]
        , if List.isEmpty others then
            text ""

          else
            Keyed.node "div"
                [ class "onyx-call-filmstrip"
                , attribute "role" "list"
                , attribute "aria-label" "Other participants"
                ]
                (List.map (\tile -> ( tile.id, tileView model { primary = False, listItem = True } tile )) others)
        ]



-- TILE


initialOf : String -> String
initialOf name =
    String.left 1 (String.toUpper (String.filter Char.isAlphaNum name ++ name))


tag : String -> String -> String -> Html Msg
tag tone icon label =
    span [ class "onyx-tile-tag", attribute "data-tone" tone ] [ callIcon icon, span [ class "onyx-tile-tag-text" ] [ text label ] ]


tileView : Model -> { primary : Bool, listItem : Bool } -> Tile -> Html Msg
tileView model opts tile =
    let
        tags =
            List.filterMap identity
                [ if tile.kind == TileScreen then
                    Just (tag "plain" "screen" "Screen")

                  else
                    Nothing
                , if tile.hand then
                    Just (span [ class "onyx-tile-tag", attribute "data-tone" "warn", attribute "role" "img", attribute "aria-label" "Hand raised", attribute "data-testid" "hand-badge" ] [ callIcon "hand", span [ class "onyx-tile-tag-text", attribute "aria-hidden" "true" ] [ text "Hand raised" ] ])

                  else
                    Nothing
                , if tile.muted then
                    Just (tag "off" "mic-off" "Muted")

                  else
                    Nothing
                , if tile.deafened then
                    Just (tag "off" "deafen" "Deafened")

                  else
                    Nothing
                , if tile.cameraOff then
                    Just (tag "off" "cam-off" "Camera off")

                  else
                    Nothing
                , if tile.videoPaused then
                    Just (tag "off" "cam-off" "Video paused")

                  else
                    Nothing
                ]

        pipButton =
            if model.callLocal.pipSupported && tile.video then
                button
                    [ type_ "button"
                    , class "onyx-tile-btn"
                    , attribute "aria-label" ("Open " ++ displayKey tile ++ " video in Picture-in-Picture")
                    , title "Picture-in-Picture"
                    , attribute "data-testid" "native-pip-button"
                    , onClick (CallNativePip tile.id)
                    ]
                    [ callIcon "pip" ]

            else
                text ""

        pinButton =
            if tile.kind == TilePerson then
                button
                    [ type_ "button"
                    , class "onyx-tile-btn"
                    , attribute "aria-label"
                        (if tile.pinned then
                            "Unpin " ++ tile.name

                         else
                            "Pin " ++ tile.name ++ " to spotlight"
                        )
                    , attribute "aria-pressed" (boolAttr tile.pinned)
                    , title
                        (if tile.pinned then
                            "Unpin"

                         else
                            "Pin to spotlight"
                        )
                    , attribute "data-testid" "pin-button"
                    , onClick (CallPin tile.key)
                    ]
                    [ callIcon "pin" ]

            else
                text ""

        gridButton =
            if tile.kind == TileScreen && opts.primary then
                button
                    [ type_ "button"
                    , class "onyx-tile-btn"
                    , attribute "aria-label" "Switch to grid layout"
                    , title "Grid"
                    , attribute "data-testid" "share-grid-button"
                    , onClick (CallShareGrid tile.id)
                    ]
                    [ callIcon "grid" ]

            else
                text ""

        quality =
            case tile.quality of
                Just q ->
                    span
                        [ class "onyx-tile-q"
                        , attribute "role" "img"
                        , attribute "aria-label" (CallMedia.qualityLabel q ++ " connection")
                        , attribute "data-q" (String.fromInt q)
                        , attribute "data-testid" "tile-quality"
                        ]
                        (List.map
                            (\i -> span [ attribute "data-on" (boolAttr (i <= CallMedia.tileQualityBars q)) ] [])
                            [ 1, 2, 3 ]
                        )

                Nothing ->
                    text ""
    in
    div
        ([ class "onyx-tile"
         , attribute "role"
            (if opts.listItem then
                "listitem"

             else
                "group"
            )
         , attribute "aria-label" (CallMedia.tileAria tile)
         , attribute "data-testid" "participant-tile"
         , attribute "data-nick" tile.key
         , attribute "data-tile" tile.id
         , attribute "data-kind"
            (if tile.kind == TileScreen then
                "screen"

             else
                "person"
            )
         , attribute "data-speaking" (boolAttr tile.speaking)
         , attribute "data-hand" (boolAttr tile.hand)
         , attribute "data-pinned" (boolAttr tile.pinned)
         , attribute "data-video" (boolAttr tile.video)
         , attribute "data-self" (boolAttr tile.self)
         ]
            ++ (if opts.primary then
                    [ attribute "data-primary" "true" ]

                else
                    []
               )
        )
        [ span [ class "onyx-tile-avatar", attribute "aria-hidden" "true" ]
            [ span [ class "onyx-call-avatar onyx-call-avatar-lg" ] [ text (initialOf (displayKey tile)) ] ]
        , if tile.video then
            video
                [ class "onyx-tile-video"
                , attribute "data-voice-tile" tile.id
                , autoplay True
                , attribute "muted" ""
                , attribute "playsinline" ""
                , attribute "aria-hidden" "true"
                , attribute "data-testid" "tile-video"
                ]
                []

          else
            text ""
        , div [ class "onyx-tile-top" ]
            (tags ++ [ span [ class "onyx-tile-spacer" ] [], pipButton, pinButton, gridButton ])
        , div [ class "onyx-tile-bottom" ]
            [ span [ class "onyx-tile-nick", attribute "aria-hidden" "true" ]
                [ if tile.speaking then
                    span [ class "onyx-tile-talk" ] [ span [] [], span [] [], span [] [] ]

                  else
                    text ""
                , span [ class "onyx-tile-name" ] [ text tile.name ]
                , if tile.self && tile.kind == TilePerson then
                    span [ class "onyx-call-you" ] [ text " · you" ]

                  else
                    text ""
                ]
            , span [ class "onyx-tile-spacer" ] []
            , quality
            ]
        ]


{-| The bare nick behind a tile (a share tile's name is "{nick}'s
screen").
-}
displayKey : Tile -> String
displayKey tile =
    if tile.kind == TileScreen then
        String.dropRight (String.length "'s screen") tile.name

    else
        tile.name



-- C4 · QUALITY


{-| Bar connection pip (§2.4 right zone): only once the engine has
reported a tier.
-}
qualityPip : Model -> Html Msg
qualityPip model =
    case model.callLocal.tier of
        Just t ->
            span
                [ class "onyx-cq"
                , attribute "role" "img"
                , attribute "aria-label" ("Connection: " ++ CallMedia.qualityLabel t)
                , attribute "data-tier" (String.fromInt t)
                , attribute "data-testid" "connection-quality"
                ]
                [ span [ class "onyx-cq-bars", attribute "aria-hidden" "true" ]
                    (List.map (\i -> span [ attribute "data-on" (boolAttr (i <= CallMedia.qualityBars t)) ] []) [ 1, 2, 3, 4 ])
                , if t == 3 then
                    span [ class "onyx-cq-word", attribute "aria-hidden" "true" ] [ text "Poor" ]

                  else
                    text ""
                ]

        Nothing ->
            text ""


{-| Turn-off-camera prompt strip (§2.13): tier 3 held 2.5s with the
camera on, until acted on or dismissed.
-}
qualityPrompt : Model -> Html Msg
qualityPrompt model =
    if model.callQuality.show then
        div
            [ class "onyx-cq-prompt"
            , attribute "role" "status"
            , attribute "data-testid" "connection-quality-prompt"
            ]
            [ span [ class "onyx-cq-prompt-icon" ] [ callIcon "warn" ]
            , span [ class "onyx-cq-prompt-msg" ] [ text CallMedia.promptCopy.message ]
            , button
                [ type_ "button"
                , class "onyx-call-btn"
                , attribute "data-testid" "connection-quality-turn-off-camera"
                , onClick CallQualityPromptAct
                ]
                [ text CallMedia.promptCopy.actionLabel ]
            , button
                [ type_ "button"
                , class "onyx-cq-prompt-x"
                , attribute "aria-label" CallMedia.promptCopy.dismissLabel
                , attribute "data-testid" "connection-quality-dismiss"
                , onClick CallQualityPromptDismiss
                ]
                [ callIcon "x" ]
            ]

    else
        text ""
