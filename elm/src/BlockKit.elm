module BlockKit exposing
    ( Action
    , ActionKind(..)
    , Block
    , BlockType(..)
    , Button
    , ButtonKind(..)
    , Copy(..)
    , Effect(..)
    , Extraction
    , Field
    , Msg(..)
    , Option
    , Prepared
    , Review
    , Select
    , State
    , blank
    , controlId
    , copyFor
    , copyTagPrefix
    , extract
    , hasMarker
    , isOpen
    , marker
    , maxPayloadLength
    , originAllows
    , parse
    , prepare
    , safeText
    , safeUrl
    , summary
    , update
    )

{-| v3/gap-import — BlockKit-lite structured messages (roadmap 2.8;
parity rows E101–E104).

A message line `[onyx:block] {json}` renders as a structured card —
title, text, fields, selects, buttons — instead of raw text. The
decoder is strict: a payload over 4 KiB, a wrong type anywhere, an
over-long string, too many items, an unsafe character, a non-http(s)
link, or any unknown control shape rejects the whole block and the
line stays plain text. Nothing is truncated into a different value.

Controls are safe by construction:

  - URL buttons open http(s) only, with no credentials and an ASCII
    host (punycode shows as punycode), and always show the destination
    host next to the label.
  - Copy buttons copy their value and report Copied / Copy failed.
  - Action buttons and selects never send directly: they stage an
    origin-scoped review (the target must be the conversation the
    block is in — anything else renders disabled), the review shows the
    exact destination and plaintext, and confirm re-validates before
    one message goes out as you. Values may not start with `/`.
  - "Inspect structured data" opens every field, option and
    destination in a dialog.

Fixes over the SolidJS oracle (`integrations/blockKitLite.ts`,
`MessageText.tsx`): over-long values and URLs are rejected instead of
silently truncated (a truncated URL is a different destination; a
truncated copy value is a different secret); credentialed and
non-ASCII-host URLs are refused; URL buttons show where they go;
off-origin actions are visibly disabled rather than dead clicks; and a
malformed control no longer leaves a half-rendered block.

-}

import Dict exposing (Dict)
import Json.Decode as Decode
import Url



-- LIMITS


marker : String
marker =
    "[onyx:block]"


maxPayloadLength : Int
maxPayloadLength =
    4096


maxTitle : Int
maxTitle =
    120


maxText : Int
maxText =
    600


maxLabel : Int
maxLabel =
    48


maxFieldValue : Int
maxFieldValue =
    200


maxValue : Int
maxValue =
    240


maxCopyValue : Int
maxCopyValue =
    512


maxUrl : Int
maxUrl =
    500


maxTarget : Int
maxTarget =
    80


maxFields : Int
maxFields =
    6


maxSelects : Int
maxSelects =
    2


maxOptions : Int
maxOptions =
    8


maxButtons : Int
maxButtons =
    4


maxBlocksPerMessage : Int
maxBlocksPerMessage =
    4


maxKeys : Int
maxKeys =
    16



-- TYPES


type ActionKind
    = SendAction
    | SelectNotify


type alias Action =
    { kind : ActionKind
    , target : String
    , value : Maybe String
    }


type ButtonKind
    = OpenUrl { href : String, host : String }
    | CopyValue String
    | RunAction Action


type alias Button =
    { label : String
    , kind : ButtonKind
    }


type alias Option =
    { label : String
    , value : String
    }


type alias Select =
    { label : String
    , options : List Option
    , action : Action
    }


type alias Field =
    { label : String
    , value : String
    }


type BlockType
    = MessageBlock
    | ModalBlock String


type alias Block =
    { kind : BlockType
    , title : Maybe String
    , text : Maybe String
    , fields : List Field
    , selects : List Select
    , buttons : List Button
    }


type alias Extraction =
    { text : String
    , blocks : List Block
    }


type alias Prepared =
    { target : String
    , text : String
    }



-- SAFE TEXT


{-| Characters no block field may carry: C0 controls and DEL (a lone
SOH would forge a CTCP), the line/paragraph separators, and every
invisible / bidi-override / tag character (they cannot be inspected
in the review and can reorder what is shown). -}
isUnsafeChar : Char -> Bool
isUnsafeChar c =
    let
        code =
            Char.toCode c
    in
    code < 0x20
        || code == 0x7F
        || code == 0xAD
        || code == 0x061C
        || code == 0x180E
        || (code >= 0x200B && code <= 0x200F)
        || (code >= 0x2028 && code <= 0x202E)
        || (code >= 0x2060 && code <= 0x2064)
        || (code >= 0x2066 && code <= 0x2069)
        || code == 0xFEFF
        || (code >= 0xE0000 && code <= 0xE007F)


{-| Trimmed, non-empty, within `max`, no unsafe character — or
`Nothing`. Never truncates. -}
safeText : Int -> String -> Maybe String
safeText max raw =
    let
        trimmed =
            String.trim raw
    in
    if String.isEmpty trimmed || String.length trimmed > max || String.any isUnsafeChar trimmed then
        Nothing

    else
        Just trimmed


{-| A message value a control may send or copy: safe text that is not
a slash command. -}
safeValue : Int -> String -> Maybe String
safeValue max raw =
    safeText max raw
        |> Maybe.andThen
            (\v ->
                if String.startsWith "/" v then
                    Nothing

                else
                    Just v
            )


{-| A conversation target: `#room` / `&room` or an IRC nick. -}
safeTarget : String -> Maybe String
safeTarget raw =
    safeText maxTarget raw
        |> Maybe.andThen
            (\t ->
                if String.any (\c -> c == ' ' || c == ',' || c == '\t') t then
                    Nothing

                else if String.startsWith "#" t || String.startsWith "&" t then
                    if String.length t > 1 then
                        Just t

                    else
                        Nothing

                else
                    case String.uncons t of
                        Just ( first, rest ) ->
                            if isNickLead first && String.all isNickRest rest then
                                Just t

                            else
                                Nothing

                        Nothing ->
                            Nothing
            )


isNickLead : Char -> Bool
isNickLead c =
    (Char.isAlphaNum c && Char.toCode c < 0x80) || String.contains (String.fromChar c) "_[]\\`^{}|"


isNickRest : Char -> Bool
isNickRest c =
    isNickLead c || c == '.' || c == ':' || c == '-'


{-| An http(s) link with an ASCII host and no credentials, plus the
host to show. Over-long or anything else: `Nothing` (never cut). -}
safeUrl : String -> Maybe { href : String, host : String }
safeUrl raw =
    let
        trimmed =
            String.trim raw

        lower =
            String.toLower trimmed

        authority =
            trimmed
                |> String.dropLeft
                    (if String.startsWith "https://" lower then
                        8

                     else
                        7
                    )
                |> String.split "/"
                |> List.head
                |> Maybe.withDefault ""
                |> String.split "?"
                |> List.head
                |> Maybe.withDefault ""
                |> String.split "#"
                |> List.head
                |> Maybe.withDefault ""
    in
    if String.isEmpty trimmed || String.length trimmed > maxUrl then
        Nothing

    else if not (String.startsWith "https://" lower || String.startsWith "http://" lower) then
        Nothing

    else if String.any (\c -> Char.toCode c <= 0x20 || Char.toCode c >= 0x7F || c == '\\') trimmed then
        Nothing

    else if String.contains "@" authority then
        Nothing

    else
        case Url.fromString trimmed of
            Just url ->
                let
                    host =
                        String.toLower url.host
                in
                if
                    String.isEmpty host
                        || String.startsWith "." host
                        || String.endsWith "." host
                        || String.contains ".." host
                        || not (String.all (\c -> Char.isAlphaNum c || c == '.' || c == '-') host)
                then
                    Nothing

                else
                    Just { href = Url.toString url, host = host }

            Nothing ->
                Nothing



-- DECODER


{-| Whether a body carries the marker at all (cheap pre-check). -}
hasMarker : String -> Bool
hasMarker body =
    String.contains marker body


{-| Split a body into plain text plus its valid blocks. Invalid block
lines stay in the text, verbatim. At most four blocks per message. -}
extract : String -> Extraction
extract body =
    if not (hasMarker body) then
        { text = body, blocks = [] }

    else
        let
            step line ( lines, blocks ) =
                let
                    trimmed =
                        String.trim line
                in
                if String.startsWith marker trimmed && List.length blocks < maxBlocksPerMessage then
                    case parse (String.dropLeft (String.length marker) trimmed) of
                        Just block ->
                            ( lines, block :: blocks )

                        Nothing ->
                            ( line :: lines, blocks )

                else
                    ( line :: lines, blocks )

            ( keptLines, found ) =
                List.foldl step ( [], [] ) (String.lines (String.replace "\u{000D}\n" "\n" body))
        in
        { text = String.trimRight (String.join "\n" (List.reverse keptLines))
        , blocks = List.reverse found
        }


{-| A short plain description of a body for the places that cannot draw
a card (reply previews, pinned lists): the first valid block's title
(or `Structured message`) in place of its JSON. A body without the
marker is returned untouched; a clipped payload that can no longer
decode still reads `Structured message` rather than a JSON fragment.
-}
summary : String -> String
summary body =
    if not (hasMarker body) then
        body

    else
        let
            kit =
                extract body

            label block =
                "Structured message"
                    ++ (case block.title of
                            Just title ->
                                ": " ++ title

                            Nothing ->
                                ""
                       )

            lead =
                String.trim kit.text
        in
        case kit.blocks of
            block :: _ ->
                if String.isEmpty lead then
                    label block

                else
                    lead ++ " · " ++ label block

            [] ->
                if String.startsWith marker (String.trim body) then
                    "Structured message"

                else
                    body


{-| Strict payload decode (see the module doc). -}
parse : String -> Maybe Block
parse raw =
    let
        payload =
            String.trim raw
    in
    if String.isEmpty payload || String.length payload > maxPayloadLength then
        Nothing

    else
        case Decode.decodeString blockDecoder payload of
            Ok block ->
                if block.title == Nothing && block.text == Nothing && List.isEmpty block.fields && List.isEmpty block.selects && List.isEmpty block.buttons then
                    Nothing

                else
                    Just block

            Err _ ->
                Nothing


{-| An optional field: absent / null passes as `Nothing`; present
must decode. -}
optional : String -> Decode.Decoder a -> Decode.Decoder (Maybe a)
optional name decoder =
    Decode.oneOf
        [ Decode.field name (Decode.null Nothing)
        , Decode.field name decoder |> Decode.map Just
        , Decode.keyValuePairs Decode.value
            |> Decode.andThen
                (\pairs ->
                    if List.any (\( k, _ ) -> k == name) pairs then
                        Decode.fail ("bad " ++ name)

                    else
                        Decode.succeed Nothing
                )
        ]


{-| A string field that must pass `check`, failing the decode when not. -}
checked : (String -> Maybe a) -> Decode.Decoder a
checked check =
    Decode.string
        |> Decode.andThen
            (\s ->
                case check s of
                    Just v ->
                        Decode.succeed v

                    Nothing ->
                        Decode.fail "unsafe"
            )


{-| Optional text: an empty / whitespace string counts as absent. -}
optionalText : String -> Int -> Decode.Decoder (Maybe String)
optionalText name max =
    optional name
        (Decode.string
            |> Decode.andThen
                (\s ->
                    if String.isEmpty (String.trim s) then
                        Decode.succeed Nothing

                    else
                        case safeText max s of
                            Just v ->
                                Decode.succeed (Just v)

                            Nothing ->
                                Decode.fail "unsafe"
                )
        )
        |> Decode.map (Maybe.andThen identity)


boundedList : String -> Int -> Decode.Decoder a -> Decode.Decoder (List a)
boundedList name max item =
    optional name (Decode.list Decode.value)
        |> Decode.andThen
            (\values ->
                case values of
                    Nothing ->
                        Decode.succeed []

                    Just list ->
                        if List.length list > max then
                            Decode.fail ("too many " ++ name)

                        else
                            List.foldr
                                (\value acc ->
                                    Decode.map2 (::)
                                        (case Decode.decodeValue item value of
                                            Ok v ->
                                                Decode.succeed v

                                            Err _ ->
                                                Decode.fail ("bad " ++ name)
                                        )
                                        acc
                                )
                                (Decode.succeed [])
                                list
            )


object : Decode.Decoder ()
object =
    Decode.keyValuePairs Decode.value
        |> Decode.andThen
            (\pairs ->
                if List.length pairs > maxKeys then
                    Decode.fail "too many keys"

                else
                    Decode.succeed ()
            )


blockDecoder : Decode.Decoder Block
blockDecoder =
    object
        |> Decode.andThen
            (\_ ->
                Decode.map2 Tuple.pair
                    (optional "type" Decode.string)
                    (Decode.map2 Tuple.pair (optionalText "triggerLabel" maxLabel) (optionalText "trigger_label" maxLabel))
            )
        |> Decode.andThen
            (\( kind, ( trigger, triggerSnake ) ) ->
                let
                    body blockType =
                        Decode.map5 (Block blockType)
                            (optionalText "title" maxTitle)
                            (optionalText "text" maxText)
                            (boundedList "fields" maxFields fieldDecoder)
                            (boundedList "selects" maxSelects selectDecoder)
                            (boundedList "buttons" maxButtons buttonDecoder)
                in
                case kind of
                    Nothing ->
                        body MessageBlock

                    Just "message" ->
                        body MessageBlock

                    Just "modal" ->
                        body (ModalBlock (Maybe.withDefault "" (orElse triggerSnake trigger)))
                            |> Decode.map
                                (\b ->
                                    case b.kind of
                                        ModalBlock "" ->
                                            { b
                                                | kind = ModalBlock ("Open " ++ Maybe.withDefault "details" b.title)
                                                , title = Just (Maybe.withDefault "Details" b.title)
                                            }

                                        _ ->
                                            { b | title = Just (Maybe.withDefault "Details" b.title) }
                                )

                    Just _ ->
                        Decode.fail "unknown block type"
            )


orElse : Maybe a -> Maybe a -> Maybe a
orElse fallback primary =
    case primary of
        Just _ ->
            primary

        Nothing ->
            fallback


fieldDecoder : Decode.Decoder Field
fieldDecoder =
    object
        |> Decode.andThen
            (\_ ->
                Decode.map2 Field
                    (Decode.field "label" (checked (safeText maxLabel)))
                    (optionalText "value" maxFieldValue |> Decode.map (Maybe.withDefault ""))
            )


actionDecoder : Decode.Decoder Action
actionDecoder =
    object
        |> Decode.andThen
            (\_ ->
                Decode.map3 (\kind target value -> { kind = kind, target = target, value = value })
                    (Decode.field "type" Decode.string
                        |> Decode.andThen
                            (\t ->
                                case t of
                                    "send" ->
                                        Decode.succeed SendAction

                                    "select-notify" ->
                                        Decode.succeed SelectNotify

                                    _ ->
                                        Decode.fail "unknown action"
                            )
                    )
                    (Decode.field "target" (checked safeTarget))
                    (optional "value" (checked (safeValue maxValue)))
            )
        |> Decode.andThen
            (\action ->
                if action.kind == SendAction && action.value == Nothing then
                    Decode.fail "send needs a value"

                else
                    Decode.succeed action
            )


optionDecoder : Decode.Decoder Option
optionDecoder =
    object
        |> Decode.andThen
            (\_ ->
                Decode.map2 Tuple.pair
                    (Decode.field "label" (checked (safeText maxLabel)))
                    (optional "value" (checked (safeValue maxValue)))
            )
        |> Decode.andThen
            (\( label, value ) ->
                case value of
                    Just v ->
                        Decode.succeed { label = label, value = v }

                    Nothing ->
                        case safeValue maxValue label of
                            Just v ->
                                Decode.succeed { label = label, value = v }

                            Nothing ->
                                Decode.fail "option value"
            )


selectDecoder : Decode.Decoder Select
selectDecoder =
    object
        |> Decode.andThen
            (\_ ->
                Decode.map3 Select
                    (Decode.field "label" (checked (safeText maxLabel)))
                    (boundedList "options" maxOptions optionDecoder
                        |> Decode.andThen
                            (\options ->
                                if List.isEmpty options then
                                    Decode.fail "no options"

                                else
                                    Decode.succeed options
                            )
                    )
                    (Decode.field "action" actionDecoder
                        |> Decode.andThen
                            (\action ->
                                if action.kind == SelectNotify then
                                    Decode.succeed action

                                else
                                    Decode.fail "select needs select-notify"
                            )
                    )
            )


buttonDecoder : Decode.Decoder Button
buttonDecoder =
    object
        |> Decode.andThen
            (\_ ->
                Decode.map4
                    (\label url value action -> { label = label, url = url, value = value, action = action })
                    (Decode.field "label" (checked (safeText maxLabel)))
                    (optional "url" (checked safeUrl))
                    (optional "value" (checked (safeText maxCopyValue)))
                    (optional "action" actionDecoder)
            )
        |> Decode.andThen
            (\b ->
                case ( b.url, b.value, b.action ) of
                    ( Just url, Nothing, Nothing ) ->
                        Decode.succeed { label = b.label, kind = OpenUrl url }

                    ( Nothing, Just value, Nothing ) ->
                        Decode.succeed { label = b.label, kind = CopyValue value }

                    ( Nothing, Nothing, Just action ) ->
                        if action.kind == SendAction then
                            Decode.succeed { label = b.label, kind = RunAction action }

                        else
                            Decode.fail "buttons send"

                    _ ->
                        Decode.fail "a button does exactly one thing"
            )



-- ACTIONS


{-| Whether an action may run in this conversation: its target must be
the conversation the block is rendered in. -}
originAllows : String -> Action -> Bool
originAllows origin action =
    case ( safeTarget origin, safeTarget action.target ) of
        ( Just o, Just t ) ->
            String.toLower o == String.toLower t && o == origin

        _ ->
            False


{-| Re-validate an action into the exact request a review may show:
origin-scoped target, safe value, select-notify `prefix: choice`.
Call when staging AND again at confirm; send only an identical result. -}
prepare : String -> Action -> Maybe String -> Maybe Prepared
prepare origin action selected =
    if not (originAllows origin action) then
        Nothing

    else
        let
            text =
                case action.kind of
                    SendAction ->
                        Maybe.andThen (safeValue maxValue) action.value

                    SelectNotify ->
                        case Maybe.andThen (safeValue maxValue) selected of
                            Nothing ->
                                Nothing

                            Just choice ->
                                case action.value of
                                    Nothing ->
                                        Just choice

                                    Just prefix ->
                                        Maybe.andThen (\p -> safeValue maxValue (p ++ ": " ++ choice)) (safeValue maxValue prefix)
        in
        Maybe.map (\t -> { target = origin, text = t }) text



-- STATE


type Copy
    = Copied Float
    | CopyFailed Float


type alias Review =
    { origin : String
    , action : Action
    , selected : Maybe String
    , prepared : Prepared
    , returnTo : String
    }


type alias State =
    { review : Maybe Review
    , inspect : Maybe { origin : String, key : String, block : Block, openerId : String }
    , copies : Dict String Copy
    , copyPending : Dict String String
    , stages : Int
    }


blank : State
blank =
    { review = Nothing
    , inspect = Nothing
    , copies = Dict.empty
    , copyPending = Dict.empty
    , stages = 0
    }


isOpen : State -> Bool
isOpen state =
    state.review /= Nothing || state.inspect /= Nothing


copyTagPrefix : String
copyTagPrefix =
    "blockkit:"


{-| DOM id for one control of one block (stable per message). -}
controlId : String -> String -> String
controlId blockKey part =
    "bk-" ++ String.map (\c -> if Char.isAlphaNum c then c else '-') (blockKey ++ "-" ++ part)


copyFor : State -> Float -> String -> Maybe Copy
copyFor state now key =
    case Dict.get key state.copies of
        Just (Copied until) ->
            if now < until then
                Just (Copied until)

            else
                Nothing

        Just (CopyFailed until) ->
            if now < until then
                Just (CopyFailed until)

            else
                Nothing

        Nothing ->
            Nothing


type Msg
    = Stage { origin : String, action : Action, selected : Maybe String, returnTo : String }
    | ConfirmSend
    | CancelReview
    | CopyClicked { key : String, value : String }
    | CopyResult { tag : String, ok : Bool }
    | OpenInspect { origin : String, key : String, block : Block, openerId : String }
    | CloseInspect
    | Escape
    | Tick Float


type Effect
    = CopyText { text : String, tag : String }
    | SendText Prepared
    | FocusId String


update : Float -> Msg -> State -> ( State, List Effect )
update now msg state =
    case msg of
        Stage s ->
            case prepare s.origin s.action s.selected of
                Just prepared ->
                    ( { state
                        | review = Just { origin = s.origin, action = s.action, selected = s.selected, prepared = prepared, returnTo = s.returnTo }
                        , stages = state.stages + 1
                      }
                    , []
                    )

                Nothing ->
                    ( { state | stages = state.stages + 1 }, [] )

        ConfirmSend ->
            case state.review of
                Just review ->
                    let
                        again =
                            prepare review.origin review.action review.selected
                    in
                    ( { state | review = Nothing }
                    , (if again == Just review.prepared then
                        [ SendText review.prepared ]

                       else
                        []
                      )
                        ++ [ FocusId review.returnTo ]
                    )

                Nothing ->
                    ( state, [] )

        CancelReview ->
            case state.review of
                Just review ->
                    ( { state | review = Nothing }, [ FocusId review.returnTo ] )

                Nothing ->
                    ( state, [] )

        CopyClicked { key, value } ->
            case safeText maxCopyValue value of
                Just v ->
                    let
                        tag =
                            copyTagPrefix ++ key
                    in
                    ( { state | copyPending = Dict.insert tag key state.copyPending, copies = Dict.remove key state.copies }
                    , [ CopyText { text = v, tag = tag } ]
                    )

                Nothing ->
                    ( state, [] )

        CopyResult { tag, ok } ->
            case Dict.get tag state.copyPending of
                Just key ->
                    ( { state
                        | copyPending = Dict.remove tag state.copyPending
                        , copies =
                            Dict.insert key
                                (if ok then
                                    Copied (now + 1600)

                                 else
                                    CopyFailed (now + 2400)
                                )
                                state.copies
                      }
                    , []
                    )

                Nothing ->
                    ( state, [] )

        OpenInspect i ->
            ( { state | inspect = Just i, review = Nothing }, [] )

        CloseInspect ->
            case state.inspect of
                Just i ->
                    ( { state | inspect = Nothing, review = Nothing }, [ FocusId i.openerId ] )

                Nothing ->
                    ( state, [] )

        Escape ->
            if state.review /= Nothing then
                update now CancelReview state

            else
                update now CloseInspect state

        Tick t ->
            let
                live _ copy =
                    case copy of
                        Copied until ->
                            t < until

                        CopyFailed until ->
                            t < until
            in
            if Dict.isEmpty state.copies then
                ( state, [] )

            else
                ( { state | copies = Dict.filter live state.copies }, [] )
