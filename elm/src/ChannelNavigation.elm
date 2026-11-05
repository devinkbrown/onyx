module ChannelNavigation exposing
    ( Folder
    , Memory
    , applyEdits
    , defaultFolder
    , empty
    , encode
    , forgetChannel
    , maxChannels
    , maxOrder
    , normalizeChannel
    , parseValue
    , rememberChannel
    , storageKey
    )

{-| Owner-scoped channel navigation document.

Port of `parseChannelNavigationMemory` / `normalizeNavigationChannel`
in `src/lib/channelNavigationMemory.ts` and the folder bounds in
`src/lib/store/channelFoldersPersistence.ts`. Lists keep first-seen
order (a JS `Set` walk), so they are not sorted. The ports bridge
stores the encoded object under `storageKey`.
-}

import Json.Decode as Decode
import Json.Encode as Encode
import PersonSafety


type alias Folder =
    { id : String
    , name : String
    , channels : List String
    , collapsed : Bool
    }


type alias Memory =
    { pinned : List String
    , followed : List String
    , starred : List String
    , forum : List String
    , channelFolders : List Folder
    , channelOrder : List String
    , nsfwChannels : List String
    }


maxChannels : Int
maxChannels =
    256


maxOrder : Int
maxOrder =
    512


maxChannelLength : Int
maxChannelLength =
    128


defaultFolder : Folder
defaultFolder =
    { id = "default"
    , name = "TEXT CHANNELS"
    , channels = []
    , collapsed = False
    }


empty : Memory
empty =
    { pinned = []
    , followed = []
    , starred = []
    , forum = []
    , channelFolders = [ defaultFolder ]
    , channelOrder = []
    , nsfwChannels = []
    }


normalizeChannel : String -> Maybe String
normalizeChannel raw =
    let
        channel =
            String.toLower (String.trim raw)
    in
    if String.isEmpty channel || String.length channel > maxChannelLength then
        Nothing

    else if not (String.startsWith "#" channel || String.startsWith "&" channel) then
        Nothing

    else if String.any invalidChannelChar channel then
        Nothing

    else
        Just channel


invalidChannelChar : Char -> Bool
invalidChannelChar char =
    let
        code =
            Char.toCode char
    in
    char == ' ' || char == ',' || code <= 31 || code == 127


rememberChannel : Int -> String -> List String -> List String
rememberChannel cap channel list =
    case normalizeChannel channel of
        Nothing ->
            list

        Just name ->
            if List.member name list || List.length list >= cap then
                list

            else
                list ++ [ name ]


forgetChannel : String -> List String -> List String
forgetChannel channel list =
    case normalizeChannel channel of
        Nothing ->
            list

        Just name ->
            List.filter (\item -> item /= name) list


{-| Drop removals, then append additions in order, capped. -}
applyEdits : Int -> List String -> List String -> List String -> List String
applyEdits cap removes adds existing =
    let
        kept =
            List.filter (\item -> not (List.member item removes)) existing
    in
    List.foldl (rememberChannel cap) kept adds


parseValue : Decode.Value -> Memory
parseValue value =
    case Decode.decodeValue memoryDecoder value of
        Ok memory ->
            memory

        Err _ ->
            empty


encode : Memory -> String
encode memory =
    Encode.encode 0
        (Encode.object
            [ ( "pinnedChannels", encodeChannels memory.pinned )
            , ( "followedChannels", encodeChannels memory.followed )
            , ( "starredChannels", encodeChannels memory.starred )
            , ( "channelFolders", Encode.list encodeFolder memory.channelFolders )
            , ( "channelOrder", encodeChannels memory.channelOrder )
            , ( "nsfwChannels", encodeChannels memory.nsfwChannels )
            , ( "forumChannels", encodeChannels memory.forum )
            ]
        )


storageKey : String -> { serverUrl : String, identity : String } -> Maybe String
storageKey base owner =
    if String.isEmpty base then
        Nothing

    else if rejectedOwner owner.serverUrl 2048 || rejectedOwner owner.identity 256 then
        Nothing

    else
        let
            pair =
                Encode.encode 0
                    (Encode.list Encode.string [ owner.serverUrl, String.toLower owner.identity ])
        in
        Just (base ++ ":owner:" ++ PersonSafety.percentEncode pair)


rejectedOwner : String -> Int -> Bool
rejectedOwner value cap =
    String.isEmpty value || String.length value > cap || value /= String.trim value


memoryDecoder : Decode.Decoder Memory
memoryDecoder =
    Decode.map7 Memory
        (channelField "pinnedChannels" maxChannels)
        (channelField "followedChannels" maxChannels)
        (channelField "starredChannels" maxChannels)
        (channelField "forumChannels" maxChannels)
        (Decode.oneOf [ Decode.field "channelFolders" Decode.value |> Decode.map parseFolders, Decode.succeed [ defaultFolder ] ])
        (channelField "channelOrder" maxOrder)
        (channelField "nsfwChannels" maxChannels)


channelField : String -> Int -> Decode.Decoder (List String)
channelField name cap =
    Decode.oneOf
        [ Decode.field name (Decode.list Decode.value) |> Decode.map (boundChannels cap)
        , Decode.succeed []
        ]


boundChannels : Int -> List Decode.Value -> List String
boundChannels cap values =
    List.foldl
        (\value acc ->
            case Decode.decodeValue Decode.string value of
                Ok raw ->
                    rememberChannel cap raw acc

                Err _ ->
                    acc
        )
        []
        values


parseFolders : Decode.Value -> List Folder
parseFolders value =
    case Decode.decodeValue (Decode.list Decode.value) value of
        Ok raws ->
            let
                folders =
                    List.foldl takeFolder ( [], [], [] ) raws
                        |> (\( acc, _, _ ) -> List.reverse acc)
            in
            if List.isEmpty folders then
                [ defaultFolder ]

            else
                folders

        Err _ ->
            [ defaultFolder ]


takeFolder : Decode.Value -> ( List Folder, List String, List String ) -> ( List Folder, List String, List String )
takeFolder value ( folders, ids, claimed ) =
    if List.length folders >= 32 then
        ( folders, ids, claimed )

    else
        case Decode.decodeValue folderDecoder value of
            Ok folder ->
                if List.member folder.id ids || hasControl folder.id || hasControl folder.name then
                    ( folders, ids, claimed )

                else
                    let
                        named =
                            String.trim folder.name

                        channels =
                            List.foldl (claimChannel claimed) ( [], claimed ) folder.channels
                                |> Tuple.first
                                |> List.reverse
                    in
                    if String.isEmpty named || String.length named > 128 then
                        ( folders, ids, claimed )

                    else
                        ( { folder | name = named, channels = channels } :: folders
                        , folder.id :: ids
                        , List.foldl (\channel acc -> channel :: acc) claimed channels
                        )

            Err _ ->
                ( folders, ids, claimed )


claimChannel : List String -> String -> ( List String, List String ) -> ( List String, List String )
claimChannel _ raw ( channels, claimed ) =
    if List.length channels >= 256 then
        ( channels, claimed )

    else
        case normalizeChannel raw of
            Just name ->
                if List.member name claimed then
                    ( channels, claimed )

                else
                    ( name :: channels, name :: claimed )

            Nothing ->
                ( channels, claimed )


folderDecoder : Decode.Decoder Folder
folderDecoder =
    Decode.map4 Folder
        (Decode.field "id" Decode.string)
        (Decode.field "name" Decode.string)
        (Decode.field "channels" (Decode.list Decode.string))
        (Decode.oneOf [ Decode.field "collapsed" Decode.bool, Decode.succeed False ])


hasControl : String -> Bool
hasControl value =
    String.any (\char -> Char.toCode char <= 31 || Char.toCode char == 127) value


encodeChannels : List String -> Encode.Value
encodeChannels channels =
    Encode.list Encode.string channels


encodeFolder : Folder -> Encode.Value
encodeFolder folder =
    Encode.object
        [ ( "id", Encode.string folder.id )
        , ( "name", Encode.string folder.name )
        , ( "channels", Encode.list Encode.string folder.channels )
        , ( "collapsed", Encode.bool folder.collapsed )
        ]
