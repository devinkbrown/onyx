module GapConvo exposing
    ( DraftStatus(..)
    , EditOutcome(..)
    , Caret
    , Landing
    , Msg(..)
    , Out(..)
    , PendingEdit
    , PhotoChoice
    , PhotoPrep
    , State
    , blank
    , blankPhotoChoice
    , decideEdit
    , decodeDrafts
    , decodePhotoPrepared
    , draftKey
    , draftStatusCopy
    , draftStatusFromString
    , editBody
    , editRefOf
    , encodeDrafts
    , insertAtCaret
    , landingMatches
    , landingRowId
    , maxDraftLength
    , maxDrafts
    , maxPendingEdits
    , maxStagedTargets
    , pendingEditKey
    , photoKey
    , photoNote
    , photoUploadVariant
    , sanitizeDrafts
    , stashEdit
    , takeEdit
    , undeliveredCopy
    )

{-| v3/gap-convo — the pure core of the conversation gap slice.

  - **Server-native edits.** onyx-server fans an `EDIT` out as
    `@msgid=<orig>;+draft/edit=<orig>;+draft/revision=1 PRIVMSG <target> :<text>`
    (`server.zig` `handleEdit`): the line re-uses the ORIGINAL msgid, so
    it must never fold as a new row nor be swallowed by the rewind dedup.
    Edits that reach us before their target row wait here (bounded).
  - **Drafts on this device**, owner-scoped like the oracle
    `onyx:composer-drafts` journal (same key shape, same bounds).
  - **Photo privacy**: what the ports bridge learned about a staged
    photo (metadata removed / none / cannot be removed) and the user's
    choice (Original / Compact, keep metadata only on explicit consent).
  - **Landing** on a message (pins, media, vault hits, `?at=`, search).

This module never imports `App`; App owns one `gapConvo : State` field,
one `GapConvoMsg Msg` wrapper and one `GapConvoOut Out` outbound.

-}

import Dict exposing (Dict)
import Json.Decode as Decode
import Json.Encode as Encode



-- EDITS


{-| Validated inbound edit reference: first present of `+draft/edit` /
`draft/edit`, fail-closed on anything that is not a single wire token. -}
editRefOf : Dict String String -> Maybe String
editRefOf tags =
    let
        raw =
            case Dict.get "+draft/edit" tags of
                Just value ->
                    Just value

                Nothing ->
                    Dict.get "draft/edit" tags
    in
    case raw of
        Just value ->
            if validRef value then
                Just value

            else
                Nothing

        Nothing ->
            Nothing


validRef : String -> Bool
validRef value =
    not (String.isEmpty value)
        && String.length value <= 512
        && not (String.any (\c -> c <= ' ' || Char.toCode c == 127) value)
        && not (String.startsWith ":" value)
        && not (String.contains "," value)


{-| The replacement text (a CTCP ACTION wrapper unwraps to its text,
mirroring the oracle edit arm). -}
editBody : String -> String
editBody text =
    if String.startsWith "\u{0001}ACTION " text && String.endsWith "\u{0001}" text && String.length text >= 9 then
        String.slice 8 -1 text

    else
        text


type EditOutcome
    = ApplyEdit
    | SameBody
    | RefuseEdit String
    | NotTheAuthor


{-| Whether an edit may rewrite a held row. Only the original author
edits; withdrawn rows never come back; and an end-to-end encrypted row
is never rewritten in place (a plaintext "edit" of a sealed row would be
a silent downgrade, and a sealed edit cannot be verified here) — the
sealed original stays, fail closed. -}
decideEdit :
    { rowFrom : String, rowBody : String, rowSealed : Bool, rowWithdrawn : Bool }
    -> { sender : String, body : String, bodySealed : Bool }
    -> EditOutcome
decideEdit row edit =
    if String.isEmpty (String.trim edit.sender) || String.toLower (String.trim row.rowFrom) /= String.toLower (String.trim edit.sender) then
        NotTheAuthor

    else if row.rowWithdrawn then
        RefuseEdit "Ignored an edit to a deleted message."

    else if row.rowSealed || edit.bodySealed then
        RefuseEdit "Ignored an edit to an encrypted message; the original stays."

    else if row.rowBody == edit.body then
        SameBody

    else
        ApplyEdit


type alias PendingEdit =
    { from : String
    , body : String
    }


{-| Edits held for rows not loaded yet (oldest dropped past the cap). -}
maxPendingEdits : Int
maxPendingEdits =
    200


pendingEditKey : String -> String -> String
pendingEditKey bucket msgid =
    String.toLower bucket ++ "\u{0000}" ++ msgid


stashEdit : String -> PendingEdit -> State a -> State a
stashEdit key edit state =
    let
        order =
            List.filter (\k -> k /= key) state.pendingEditOrder ++ [ key ]

        overflow =
            max 0 (List.length order - maxPendingEdits)
    in
    { state
        | pendingEdits = List.foldl Dict.remove (Dict.insert key edit state.pendingEdits) (List.take overflow order)
        , pendingEditOrder = List.drop overflow order
    }


takeEdit : String -> State a -> ( Maybe PendingEdit, State a )
takeEdit key state =
    case Dict.get key state.pendingEdits of
        Nothing ->
            ( Nothing, state )

        Just edit ->
            ( Just edit
            , { state
                | pendingEdits = Dict.remove key state.pendingEdits
                , pendingEditOrder = List.filter (\k -> k /= key) state.pendingEditOrder
              }
            )



-- UNDELIVERED (401)


{-| Toast copy for a labeled send the server answered with 401. -}
undeliveredCopy : String -> Bool -> String
undeliveredCopy nick restored =
    let
        who =
            if String.isEmpty (String.trim nick) then
                "They aren't"

            else
                String.trim nick ++ " isn't"
    in
    who
        ++ " on the network right now, so the message was not sent."
        ++ (if restored then
                " Your text is back in the composer."

            else
                ""
           )



-- DRAFTS (oracle `src/lib/composer/drafts.ts`)


maxDrafts : Int
maxDrafts =
    50


maxDraftLength : Int
maxDraftLength =
    8192


maxDraftTargetLength : Int
maxDraftTargetLength =
    256


{-| Canonical draft key (mirroring `composerDraftKey`: trimmed,
lower-cased, bounded, no whitespace / comma / control characters). -}
draftKey : String -> Maybe String
draftKey target =
    let
        key =
            String.toLower (String.trim target)
    in
    if String.isEmpty key || String.length key > maxDraftTargetLength || String.any (\c -> c <= ' ' || c == ',' || Char.toCode c == 127) key then
        Nothing

    else
        Just key


{-| Bounded, sorted, non-empty drafts (mirroring
`sanitizeComposerDrafts` + `capDraftCount`). -}
sanitizeDrafts : List ( String, String ) -> List ( String, String )
sanitizeDrafts pairs =
    pairs
        |> List.filterMap
            (\( target, draft ) ->
                case draftKey target of
                    Just key ->
                        if String.isEmpty draft then
                            Nothing

                        else
                            Just ( key, String.left maxDraftLength draft )

                    Nothing ->
                        Nothing
            )
        |> Dict.fromList
        |> Dict.toList
        |> List.take maxDrafts


encodeDrafts : List ( String, String ) -> Encode.Value
encodeDrafts pairs =
    Encode.object (List.map (\( k, v ) -> ( k, Encode.string v )) pairs)


{-| Fail-closed decode of one stored journal (non-objects and
non-string values drop). -}
decodeDrafts : Decode.Value -> List ( String, String )
decodeDrafts value =
    Decode.decodeValue (Decode.keyValuePairs (Decode.oneOf [ Decode.map Just Decode.string, Decode.succeed Nothing ])) value
        |> Result.withDefault []
        |> List.filterMap
            (\( k, v ) ->
                case v of
                    Just text ->
                        Just ( k, text )

                    Nothing ->
                        Nothing
            )
        |> sanitizeDrafts


type DraftStatus
    = DraftUnknown
    | DraftSaved
    | DraftTabOnly
    | DraftLimit
    | DraftFailed


draftStatusFromString : String -> DraftStatus
draftStatusFromString raw =
    case raw of
        "saved" ->
            DraftSaved

        "limit-reached" ->
            DraftLimit

        "only-in-tab" ->
            DraftTabOnly

        "malformed" ->
            DraftFailed

        _ ->
            DraftUnknown


{-| The quiet line under the composer, in the oracle's own words
(`Composer.tsx`: "Saved here" / "Only on this tab" / "Saved with
limits; full text remains here" / "Could not save; full text remains
here"). `persistable` is False for encrypted DMs, whose drafts never
touch storage; `saved` says whether the draft is on this device. -}
draftStatusCopy : { persistable : Bool, status : DraftStatus } -> Maybe { text : String, saved : Bool }
draftStatusCopy input =
    if not input.persistable then
        Just { text = "Only on this tab", saved = False }

    else
        case input.status of
            DraftSaved ->
                Just { text = "Saved here", saved = True }

            DraftTabOnly ->
                Just { text = "Only on this tab", saved = False }

            DraftLimit ->
                Just { text = "Saved with limits; full text remains here", saved = False }

            DraftFailed ->
                Just { text = "Could not save; full text remains here", saved = False }

            DraftUnknown ->
                Nothing



-- PHOTOS


{-| What the ports bridge learned about one staged file:
`kind` is the sniffed container (`jpeg`, `png`, `webp`, `heif`,
`tiff`, `file`); `metadata` is `removed` (location / camera data
found and stripped), `none` (nothing to strip), or `unsafe` (a photo
whose metadata cannot be removed here — it is refused unless the user
explicitly keeps it). -}
type alias PhotoPrep =
    { kind : String
    , metadata : String
    , cleanBytes : Maybe Float
    , compactBytes : Maybe Float
    }


type alias PhotoChoice =
    { quality : String
    , keepMetadata : Bool
    , refused : Bool
    }


blankPhotoChoice : PhotoChoice
blankPhotoChoice =
    { quality = "original", keepMetadata = False, refused = False }


photoKey : String -> Int -> String
photoKey key index =
    key ++ "#" ++ String.fromInt index


decodePhotoPrepared : Decode.Value -> Maybe { key : String, index : Int, prep : PhotoPrep }
decodePhotoPrepared value =
    let
        kinds =
            [ "jpeg", "png", "webp", "heif", "tiff", "file" ]

        states =
            [ "removed", "none", "unsafe" ]

        bytes =
            Decode.oneOf
                [ Decode.float
                    |> Decode.map
                        (\n ->
                            if isNaN n || isInfinite n || n < 0 then
                                Nothing

                            else
                                Just n
                        )
                , Decode.succeed Nothing
                ]

        decoder =
            Decode.map5
                (\key index kind metadata ( clean, compact ) ->
                    if List.member kind kinds && List.member metadata states && not (String.isEmpty key) && index >= 0 then
                        Just { key = key, index = index, prep = { kind = kind, metadata = metadata, cleanBytes = clean, compactBytes = compact } }

                    else
                        Nothing
                )
                (Decode.field "key" Decode.string)
                (Decode.field "index" Decode.int)
                (Decode.field "kind" Decode.string)
                (Decode.field "metadata" Decode.string)
                (Decode.map2 Tuple.pair
                    (Decode.oneOf [ Decode.field "cleanBytes" bytes, Decode.succeed Nothing ])
                    (Decode.oneOf [ Decode.field "compactBytes" bytes, Decode.succeed Nothing ])
                )
    in
    Decode.decodeValue decoder value |> Result.toMaybe |> Maybe.andThen identity


{-| The upload variant the bridge must post: the cleaned bytes by
default, the recompressed copy when chosen, the untouched original only
on explicit consent. -}
photoUploadVariant : Maybe PhotoPrep -> PhotoChoice -> String
photoUploadVariant prep choice =
    if choice.keepMetadata then
        "original"

    else
        case prep of
            Just p ->
                if choice.quality == "compact" && p.compactBytes /= Nothing then
                    "compact"

                else
                    "clean"

            Nothing ->
                "clean"


{-| The privacy line under a staged photo, plus whether it warns. -}
photoNote : PhotoPrep -> PhotoChoice -> Maybe { text : String, warn : Bool }
photoNote prep choice =
    if choice.keepMetadata then
        Just { text = "Sending with its location and camera details", warn = True }

    else if prep.metadata == "unsafe" || choice.refused then
        Just { text = "Location data can't be removed from this file here", warn = True }

    else if choice.quality == "compact" && prep.compactBytes /= Nothing then
        Just { text = "Compact copy · location and camera details dropped", warn = False }

    else if prep.metadata == "removed" then
        Just { text = "Location and camera details removed", warn = False }

    else
        Nothing



-- LANDING


{-| A pending "land on this message": `id` is a server msgid or a
`row:<local id>` for msgid-less rows (vault-restored, local echoes). -}
type alias Landing =
    { target : String
    , id : String
    , focus : Bool
    }


landingMatches : String -> { a | id : Int, msgid : Maybe String } -> Bool
landingMatches id m =
    m.msgid == Just id || landingRowId m.id == id


landingRowId : Int -> String
landingRowId rowId =
    "row:" ++ String.fromInt rowId



-- STATE


{-| Targets whose staged files are remembered while you are elsewhere. -}
maxStagedTargets : Int
maxStagedTargets =
    24


type alias State staged =
    { pendingEdits : Dict String PendingEdit
    , pendingEditOrder : List String
    , landing : Maybe Landing
    , stagedByTarget : Dict String (List staged)
    , photoPrep : Dict String PhotoPrep
    , photoChoice : Dict String PhotoChoice
    , draftsOwner : Maybe { serverUrl : String, identity : String }
    , draftsLoaded : Bool
    , draftStatus : DraftStatus
    , lastDraftSnapshot : List ( String, String )
    , dropActive : Bool
    , composerCaret : Maybe Caret
    }


blank : State a
blank =
    { pendingEdits = Dict.empty
    , pendingEditOrder = []
    , landing = Nothing
    , stagedByTarget = Dict.empty
    , photoPrep = Dict.empty
    , photoChoice = Dict.empty
    , draftsOwner = Nothing
    , draftsLoaded = False
    , draftStatus = DraftUnknown
    , lastDraftSnapshot = []
    , dropActive = False
    , composerCaret = Nothing
    }


type Msg
    = PhotoPrepared Decode.Value
    | PhotoRefused { key : String, index : Int }
    | PhotoQuality { key : String, index : Int, quality : String }
    | PhotoKeepMetadata { key : String, index : Int, keep : Bool }
    | DraftsLoaded Decode.Value
    | DraftsSaved String
    | DropActive Bool
    | CollapsedShowAll
    | OpenHistoryPrefs
    | CaretMoved Caret


type Out
    = DraftsSave { serverUrl : String, identity : String, drafts : Encode.Value }
    | UploadVariant { key : String, index : Int, variant : String }
    | CaretSet { pos : Int }



-- CARET


{-| The composer's selection as the field last reported it (UTF-16
offsets, like Elm strings). Elm never reads the DOM, so the field tells
us on key-up / click / select. -}
type alias Caret =
    { start : Int
    , end : Int
    }


{-| Insert at the selection (replacing it), mirroring the oracle
`insertTextAtCaret`; a selection that no longer fits the draft (it was
rewritten since) falls back to the end. `caret` is where the cursor
belongs afterwards. -}
insertAtCaret : Maybe Caret -> String -> String -> { text : String, caret : Int }
insertAtCaret selection insert current =
    let
        len =
            String.length current

        ( start, end ) =
            case selection of
                Just sel ->
                    if sel.start >= 0 && sel.end >= sel.start && sel.end <= len then
                        ( sel.start, sel.end )

                    else
                        ( len, len )

                Nothing ->
                    ( len, len )
    in
    { text = String.left start current ++ insert ++ String.dropLeft end current
    , caret = start + String.length insert
    }
